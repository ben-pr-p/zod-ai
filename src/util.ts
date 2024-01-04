import { JsonSchema7Type, zodToJsonSchema } from "zod-to-json-schema";
import invariant from "tiny-invariant";

type ZodToJSONSchemaOutput = ReturnType<typeof zodToJsonSchema>;

export const trimGeneratedJsonSchema = (
  schema: ZodToJSONSchemaOutput
): {
  type: string;
  properties?: Record<string, JsonSchema7Type>;
  required?: string[];
  description?: string;
} => {
  const { $schema, definitions, ...rest } = schema;

  invariant(
    "type" in rest,
    "The provided Zod schema must be convertible to a JSON schema"
  );

  return "properties" in rest
    ? {
        type: rest.type as string,
        properties: rest.properties,
        required: rest.required,
        description: rest.description,
      }
    : {
        type: rest.type as string,
        description: rest.description,
      };
};

export type TrimmedJSONSchema = ReturnType<typeof trimGeneratedJsonSchema>;
