import { z, ZodFunction, ZodTuple, ZodTypeAny, ZodSchema } from "zod";
import { OpenAI } from "openai";
import invariant from "tiny-invariant";
import { zodToJsonSchema } from "zod-to-json-schema";
import { TrimmedJSONSchema, trimGeneratedJsonSchema } from "./util";

type GenerateSystemPrompt = (
  description: string,
  inputSchema: TrimmedJSONSchema,
  outputSchema: TrimmedJSONSchema
) => string;

type ModelOptions = Parameters<
  OpenAI["chat"]["completions"]["create"]
>["0"]["model"];

type AiFnOptions = {
  client: OpenAI;
  model: ModelOptions;
  overrideSystemPrompt?: GenerateSystemPrompt;
  clientSupportsJsonSchema?: boolean;
};

export const validateFunction = <
  Args extends ZodTuple<any, any>,
  Returns extends ZodTypeAny
>(
  zodFunction: ZodFunction<Args, Returns>
) => {
  const zodFnParameters = zodFunction.parameters();
  const zodFnReturn = zodFunction.returnType();
  const description = zodFunction.description;

  const argumentItems = zodFnParameters.items;

  invariant(
    argumentItems.length === 1,
    "The provided Zod function must have exactly one argument - for multiple inputs, use an input object"
  );

  invariant(
    description !== undefined,
    "The provided Zod function must have a description - this is the implementation that gets passed to the LLM."
  );

  invariant(
    zodFnReturn._def.typeName !== "ZodUnknown",
    "The provided Zod function must have a return type - this is the output shape passed to the LLM."
  );

  // TODO - allow arrays
  const providedReturnTypeIsAnObject =
    zodFnReturn._def.typeName === "ZodObject";

  const returnTypeWrappedInObject = providedReturnTypeIsAnObject
    ? zodFnReturn
    : z.object({ result: zodFnReturn });

  const inputSchema = trimGeneratedJsonSchema(
    zodToJsonSchema(argumentItems[0])
  );

  const outputSchema = trimGeneratedJsonSchema(
    zodToJsonSchema(returnTypeWrappedInObject)
  );

  return {
    inputSchema,
    outputSchema,
    description,
    postProcessResult: (result: unknown) => {
      const parsedResult = returnTypeWrappedInObject.safeParse(result);

      if (!parsedResult.success) {
        throw parsedResult.error;
      }

      return providedReturnTypeIsAnObject
        ? parsedResult.data
        : parsedResult.data.result;
    },
  };
};

export const makeAi = (options: AiFnOptions) => {
  const { client, model } = options;

  const clientSupportsJsonSchema = options.clientSupportsJsonSchema ?? false;

  const createSystemPrompt =
    options.overrideSystemPrompt ||
    ((
      description: string,
      inputSchema: TrimmedJSONSchema,
      outputSchema: TrimmedJSONSchema
    ) => `
    Your job is to generate an output for a function. The function is described as:
    ${description}

    The user will provide input that matches the following schema:
    ${JSON.stringify(inputSchema, null, 2)}

    You MUST respond in a JSON format. Your response must match the following JSONSchema definition:
    ${JSON.stringify(outputSchema, null, 2)} 
  `);

  return <Args extends ZodTuple<any, any>, Returns extends ZodTypeAny>(
    zodFunction: ZodFunction<Args, Returns>
  ) => {
    const { inputSchema, outputSchema, description, postProcessResult } =
      validateFunction(zodFunction);

    const systemPrompt = createSystemPrompt(
      description,
      inputSchema,
      outputSchema
    );

    const responseFormat = clientSupportsJsonSchema
      ? ({
          type: "json_object",
          schema: outputSchema,
        } as const)
      : ({ type: "json_object" } as const);

    return async (argument: z.infer<Args>[0]) => {
      const aiResult = await client.chat.completions.create({
        model,
        response_format: responseFormat,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: JSON.stringify(argument),
          },
        ],
      });

      const jsonResponse = aiResult.choices[0].message.content;
      const zodParsedResult = postProcessResult(JSON.parse(jsonResponse!));
      return zodParsedResult as z.infer<Returns>;
    };
  };
};
