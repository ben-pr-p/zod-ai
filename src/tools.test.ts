import { describe, test, expect } from "bun:test";
import { OpenAI } from "openai";
import { z } from "zod";
import { cleanEnv, str } from "envalid";
import { formatTools, handleToolCalls, makeTool } from "./tools";

const config = cleanEnv(process.env, {
  OPENAI_API_KEY: str(),
});

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

const getWeather = makeTool(
  z
    .function()
    .returns(
      z.object({
        temperature: z.number(),
        topLevelDescription: z.string(),
        humidity: z.string(),
      })
    )
    .describe("Gets the weather for the current user"),
  () => {
    return {
      temperature: 72,
      topLevelDescription: "Sunny",
      humidity: "Low",
    };
  }
);

const resolveContact = makeTool(
  z
    .function()
    .args(z.object({ name: z.string() }))
    .returns(z.string())
    .describe(
      "Resolves a contact by searching for them in the user's contacts"
    ),

  ({ name }) => {
    return `Resolved contact ${name}`;
  }
);

const getPalindrome = makeTool(
  z
    .function()
    .args(z.string())
    .returns(z.string())
    .describe("Returns the palindrome of the input string"),

  (input) => {
    return input.split("").reverse().join("");
  }
);

describe("function calling", () => {
  test("it should call the function with no parameters", async () => {
    const tools = { getWeather };

    const nextChatResponse = await client.chat.completions.create({
      model: "gpt-3.5-turbo-1106",
      messages: [{ role: "user", content: "What should I wear today?" }],
      tools: formatTools(tools),
    });

    const toolCallResult = await handleToolCalls(
      tools,
      nextChatResponse.choices[0].message.tool_calls!
    );

    expect(typeof toolCallResult).toEqual("object");
  });

  test("it should call the function with parameters", async () => {
    const tools = { resolveContact };

    const nextChatResponse = await client.chat.completions.create({
      model: "gpt-3.5-turbo-1106",
      messages: [{ role: "user", content: "What is Alice's last name?" }],
      tools: formatTools(tools),
    });

    const toolCallResult = await handleToolCalls(
      tools,
      nextChatResponse.choices[0].message.tool_calls!
    );

    expect(toolCallResult[0].content).toEqual("Resolved contact Alice");
  });

  test("it should handle parameters that are simply strings", async () => {
    const tools = { getPalindrome };

    const nextChatResponse = await client.chat.completions.create({
      model: "gpt-3.5-turbo-1106",
      messages: [
        { role: "user", content: "What is the palindrome of 'hello'?" },
      ],
      tools: formatTools(tools),
    });

    const toolCallResult = await handleToolCalls(
      tools,
      nextChatResponse.choices[0].message.tool_calls!
    );

    expect(toolCallResult[0].content).toEqual("olleh");
  });
});
