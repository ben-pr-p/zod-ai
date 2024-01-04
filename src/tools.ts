import OpenAITypes from "openai";
import invariant from "tiny-invariant";
import {
  ZodFunction,
  ZodTuple,
  ZodTypeAny,
  z,
  ZodPromise,
  ZodUnion,
} from "zod";
import { trimGeneratedJsonSchema } from "./util";
import zodToJsonSchema from "zod-to-json-schema";

export type ToolRecord = Record<string, Tool<any, any>>;

export const formatTools = (
  tools: ToolRecord
): Array<OpenAITypes.ChatCompletionTool> => {
  const fnsWithNames = Object.entries(tools).map(([name, fn]) => ({
    name,
    fn,
  }));

  return fnsWithNames.map(({ name, fn }) => {
    const functionArguments = fn.zodFunctionSchema.parameters().items;

    invariant(
      functionArguments.length === 1 || functionArguments.length === 0,
      "The provided Zod function must have exactly zero arguments or one argument - for multiple inputs, use an input object"
    );

    const descriptionAddendum = `Responses will match the following JSONSchema definition: ${JSON.stringify(
      trimGeneratedJsonSchema(
        zodToJsonSchema(fn.zodFunctionSchema.returnType())
      )
    )}`;

    const description = `${
      fn.zodFunctionSchema.description
        ? fn.zodFunctionSchema.description + "\n\n"
        : ""
    }${descriptionAddendum}`;

    const openAiFunctionSpec: OpenAITypes.ChatCompletionTool["function"] = {
      name: name,
      description: description,
      parameters:
        functionArguments.length === 1 && functionArguments[0] !== undefined
          ? trimGeneratedJsonSchema(zodToJsonSchema(functionArguments[0]))
          : undefined,
    };

    return {
      type: "function",
      function: openAiFunctionSpec,
    };
  });
};

export const handleToolCalls = async (
  tools: ToolRecord,
  toolCalls: Array<OpenAITypes.ChatCompletionMessageToolCall>
): Promise<OpenAITypes.ChatCompletionToolMessageParam[]> => {
  return await Promise.all(
    toolCalls.map(async (call) => {
      const { name, arguments: toolCallArguments } = call.function;
      const tool = tools[name];

      const callResult = await tool.implementation(
        JSON.parse(toolCallArguments)
      );

      const callResultAsString =
        typeof callResult === "string"
          ? callResult
          : typeof callResult === "number"
          ? callResult.toString()
          : JSON.stringify(callResult);

      return {
        role: "tool",
        tool_call_id: call.id,
        name: name,
        content: callResultAsString,
      };
    })
  );
};

type MaybePromise<WrappedType> = WrappedType | Promise<WrappedType>;
type Tool<Args extends ZodTuple<any, any>, Returns extends ZodTypeAny> = {
  zodFunctionSchema: ZodFunction<Args, Returns>;
  implementation: (arg?: z.infer<Args>) => MaybePromise<z.infer<Returns>>;
};

const maybeAZodPromise = <WrappedType extends ZodTypeAny>(
  zodType: WrappedType
) => {
  return z.union([zodType, z.promise(zodType)]);
};
type MaybeAZodPromise<WrappedType extends ZodTypeAny> = ZodUnion<
  [WrappedType, ZodPromise<WrappedType>]
>;

export const makeTool = <
  Args extends ZodTuple<any, any>,
  Returns extends ZodTypeAny
>(
  zodFunctionSchema: ZodFunction<Args, Returns>,
  implementation: Parameters<
    ZodFunction<Args, MaybeAZodPromise<Returns>>["implement"]
  >[0]
): Tool<any, any> => {
  // Can only have 0 or 1 arguments
  invariant(
    zodFunctionSchema.parameters().items.length <= 1,
    "The provided Zod function must have exactly zero arguments or one argument - for multiple inputs, use an input object"
  );

  const argumentType = zodFunctionSchema.parameters().items[0];

  const shouldOverrideArgumentWithNestedInputKey =
    argumentType !== undefined && argumentType._def.typeName !== "ZodObject";

  const overriddenArgumentType = shouldOverrideArgumentWithNestedInputKey
    ? z.object({ input: argumentType })
    : argumentType;

  const overriddenFunctionSchema = zodFunctionSchema.args(
    overriddenArgumentType
  );

  const callableImplementation = overriddenFunctionSchema
    .returns(maybeAZodPromise(zodFunctionSchema.returnType()))
    .implement((rawFromOpenAi) => {
      const argToPassToImplementation = shouldOverrideArgumentWithNestedInputKey
        ? rawFromOpenAi.input
        : rawFromOpenAi;

      return implementation(argToPassToImplementation);
    });

  return {
    zodFunctionSchema: overriddenFunctionSchema,
    implementation: callableImplementation,
  };
};

export const isToolCallRequested = (
  message: OpenAITypes.ChatCompletionMessage
): boolean => {
  return message.tool_calls !== undefined && message.tool_calls.length > 0;
};
