import { makeAi, validateFunction } from "./ai";
import { describe, test, expect } from "bun:test";
import { OpenAI } from "openai";
import { z } from "zod";
import { cleanEnv, str } from "envalid";
import ollama from "ollama";

const config = cleanEnv(process.env, {
  OPENAI_API_KEY: str(),
  ANYSCALE_ENDPOINTS_API_KEY: str(),
});

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

const ai = makeAi({
  client,
  model: "gpt-3.5-turbo-1106",
});

describe("validateFunction", () => {
  test("it should throw if no description", () => {
    const fn = z
      .function()
      .args(z.object({ a: z.number() }))
      .returns(z.string());

    expect(() => validateFunction(fn)).toThrow();
  });

  test("it should throw if no input schema", () => {
    const fn = z.function().returns(z.string()).describe("Sample description");

    expect(() => validateFunction(fn)).toThrow();
  });

  test("it should throw if no output schema", () => {
    const fn = z.function().args(z.string()).describe("Sample description");

    expect(() => validateFunction(fn)).toThrow();
  });

  test("it should transform a primitive return type into an object with a result key", () => {
    const fn = z
      .function()
      .args(z.string())
      .returns(z.string())
      .describe("Sample description");

    const { outputSchema } = validateFunction(fn);

    expect(outputSchema).toEqual({
      type: "object",
      properties: {
        result: {
          type: "string",
        },
      },
      required: ["result"],
    });
  });
});

describe("ai function", () => {
  test("it should properly unnest from a result keyed object", async () => {
    const getPopCultureReferenceFromNumber = ai(
      z
        .function()
        .args(z.number())
        .returns(z.string())
        .describe(
          "Return a common movie title or book with this number as a part of the title or key plot element"
        )
    );

    const result = await getPopCultureReferenceFromNumber(7);
    expect(typeof result).toBe("string");
  });

  test("it should handle more complex object constructions", async () => {
    const returnPersonDetailsFromJumbledDescription = ai(
      z
        .function()
        .args(z.string())
        .returns(
          z.object({
            name: z.string(),
            age: z.number(),
            location: z.string(),
          })
        )
        .describe(
          "Return a person object with the name, age, and location properties"
        )
    );

    const result = await returnPersonDetailsFromJumbledDescription(
      "George is 30 years old and lives in New York City"
    );

    expect(result).toEqual({
      name: "George",
      age: 30,
      location: "New York City",
    });
  });

  test("it should be able to return arrays", async () => {
    const returnFamousActorsFromVibe = ai(
      z
        .function()
        .args(z.string())
        .returns(z.array(z.string()))
        .describe(
          "Return a list of famous actors that match the user provided vibe"
        )
    );

    const result = await returnFamousActorsFromVibe("villain");
    expect(Array.isArray(result)).toEqual(true);
  });
});

const anyscale = new OpenAI({
  baseURL: "https://api.endpoints.anyscale.com/v1",
  apiKey: config.ANYSCALE_ENDPOINTS_API_KEY,
});

describe("anyscale json schema addition", () => {
  test("anyscale schema additions should be passed along and successfully constrain output", async () => {
    /**
     * This provides an overrideSystemPrompt that excludes providing the output schema
     * This tests that anyscale is actually constraining generation, because otherwise
     * the LLM would have no way to know about the output schemaj
     */
    const anyscaleAiFn = makeAi({
      clientSupportsJsonSchema: true,
      client: anyscale,
      overrideSystemPrompt(description, inputSchema, outputSchema) {
        return `
        Your job is to generate an output for a function. The function is described as:
        ${description}

        The user will provide input that matches the following schema:
        ${JSON.stringify(inputSchema, null, 2)}

        Respond in JSON
        `;
      },
      model: "mistralai/Mistral-7B-Instruct-v0.1",
    });

    const returnFamousActorsFromVibe = anyscaleAiFn(
      z
        .function()
        .args(z.string())
        .returns(
          z.object({
            actors: z.array(z.string()),
          })
        )
        .describe(
          "Return a list of famous actors that match the user provided vibe"
        )
    );

    const result = await returnFamousActorsFromVibe("villain");

    expect(Array.isArray(result.actors)).toEqual(true);
  }, 10_000);
});

describe("ollama", () => {
  test("seeing how ollama works", async () => {
    const mistralAiFn = makeAi({
      client: ollama,
      model: "dolphin2.1-mistral:latest",
    });

    const returnFamousActorsFromVibe = mistralAiFn(
      z
        .function()
        .args(z.string())
        .returns(
          z.object({
            actors: z.array(z.string()),
          })
        )
        .describe(
          "Return a list of famous actors that match the user provided vibe"
        )
    );

    const result = await returnFamousActorsFromVibe("villain");
    expect(Array.isArray(result.actors)).toEqual(true);
  });
});
