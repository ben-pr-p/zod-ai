# zod-ai

This package provides functionality similar to [Marvin](https://github.com/prefecthq/marvin)'s AI utilities,
but based on [Zod](https://github.com/colinhacks/zod) functions and for the Typescript ecosystem.

I am very pleased with the developer experience, and I hope you enjoy it as well! I find that it's all I need to
build complex AI applications, instead of LangChain or other things with more features.

## Code Calling AI

You can create a function that calls an AI model by wrapping a Zod function. This simplifies instructing
the LLM to respond in the proper format, as well as parsing the response into the proper type in your codebase.

```typescript
import { makeAi } from 'zod-ai';
import { OpenAI } from 'openai';
import { z } from 'zod';

// Initialize your OpenAI client
const client = new OpenAI(process.env.OPENAI_API_KEY);

// Initialize your ai wrapper function with the client and requested model
const ai = makeAi({
  client,
  model: "gpt-3.5-turbo-1106",
});

// Wrap a Zod function that has arguments, returns, and a description
const returnFamousActorsFromVibe = ai(
  z
    .function()
    .args(z.string())
    .returns(z.array(z.string()))
    .describe(
      "Return a list of famous actors that match the user provided vibe"
    )
);
// returnFamousActorsFromVibe has type: (vibe: string) => Promise<string[]>
const actors = await returnFamousActorsFromVibe("villains");
console.log(actors) // [ "Tom Hiddleston", "Heath Ledger", "Jack Nicholson", "Anthony Hopkins" ]
```

## AI Calling Code

In the above scenario, your code calls an AI model. You can also use `zod-ai` to simplify interaction with OpenAI's
function calling (tools) feature, which allows a model calls your code.

```typescript
import { makeTool, formatTools, handleToolCalls, isToolCallRequested } from 'zod-ai';
import { OpenAI } from 'openai';

// Initialize your OpenAI client
const client = new OpenAI(process.env.OPENAI_API_KEY);

// Create a tool
const getContactInfo = makeTool(
  // First argument is a Zod function schema
  z.function()
   .args(z.object({ firstName: z.string(), lastName: z.string() }))
   .returns(z.object({ email: z.string(), phone: z.string() }))
   .describe('Search the users contact book for a contact with the provided first and last name'),

  // The function signature is validated by Zod/TS - you can use async or not, either is fine
  async ({ firstName, lastName }) => {
    const contact = await getContactFromDatabase(firstName, lastName)
    return { email: contact.email, phone: contact.phone }
  }
)

const tools = { getContactInfo }

// Now, use the provided `formatTools` to transform it into a format that OpenAI wants
const nextChatResponse = await client.chat.completions.create({
  model: "gpt-3.5-turbo-1106",
  messages: [
    { role: "user", content: "Do I have a phone number for Alice Barkley" },
  ],
  tools: formatTools(tools),
});

// Use isToolCallRequested to check if the AI requested a tool call
const toolCallRequested = isToolCallRequested(nextChatResponse);

if (toolCallRequested) {
  const toolResponseMessages = await handleToolCalls(tools, nextChatResponse.choices[0].message.tool_calls!);

  // handleToolCalls response is fully ready to send back to OpenAI, with tool ID and role set properly
  // so you can just go ahead and:
  const finalChatResponse = await client.chat.completions.create({
    model: "gpt-3.5-turbo-1106",
    messages: [
      { role: "user", content: "Do I have a phone number for Alice Barkley" },
      ...toolResponseMessages // use it here!
    ],
    tools: formatTools(tools),
  });
}
```

## Installation

`zod` and `openai` are peer dependencies and not bundled here.

Bun:
```bash
bun add zod openai zod-ai
```

NPM:
```bash
npm install --save zod openai zod-ai
```

Yarn:
```bash
yarn add zod openai zod-ai
```

## Overriding the System Prompt

In the "Code Calling AI" usage, by default, `zod-ai` will construct a system prompt that uses the description, arguments, and return type of
your zod function. That system prompt looks like this:
```
 Your job is to generate an output for a function. The function is described as:
${description}

The user will provide input that matches the following schema:
${JSON.stringify(inputSchema, null, 2)}

You MUST respond in a JSON format. Your response must match the following JSONSchema definition:
${JSON.stringify(outputSchema, null, 2)} 
``` 

If you want to change this system prompt for whatever reason, you can pass in another function to `makeAi`:
```typescript
const ai = makeAi({
  client,
  model: "gpt-3.5-turbo-1106",
  systemPrompt: (description: string, inputSchema: string, outputSchema: string) => `new system prompt`
})
```

Note that your system prompt *must* instruct the LLM to respond in JSON or OpenAI will throw an error.

## Usage of Descriptions

Zod objects and JSON Schema both support descriptions. `zod-ai` will use these descriptions if you include them.
For example, we could have written the above tool usage example as:
```typescript
const getContactInfo = makeTool(
  z.function()
   .args(z.object({ 
    firstName: z.string().describe('The first name of the contact to search for'), 
    lastName: z.string().describe('The last name of the contact to search for') 
  }))
   .returns(z.object({ email: z.string(), phone: z.string() }))
   .describe('Search the users contact book for a contact with the provided first and last name'),

  // The function signature is validated by Zod/TS - you can use async or not, either is fine
  async ({ firstName, lastName }) => {
    const contact = await getContactFromDatabase(firstName, lastName)
    return { email: contact.email, phone: contact.phone }
  }
)
```

While descriptions are helpful for the top level functions, most of the time the combination of 
the parameter name and the function description will be enough for the LLM to understand how to use the parameter.
However, if an extra description would be helpful, you can add it, just not that it counts against your input tokens.
