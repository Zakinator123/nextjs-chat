import { useCallback, useEffect, useId, useRef, useState } from 'react';
import useSWRMutation from 'swr/mutation';
import useSWR from 'swr';
import { decodeAIStreamChunk, nanoid } from '../shared/utils';

import type { CreateMessage, Message, UseChatOptions } from '../shared/types';
import { ChatCompletionRequestMessageFunctionCall, CreateChatCompletionRequestFunctionCall } from 'openai-edge';
import { ChatCompletionFunctions } from 'openai-edge/types/api';

export type { Message, CreateMessage, UseChatOptions };

export type UseChatHelpers = {
  /** Current messages in the chat */
  messages: Message[]
  /** The error object of the API request */
  error: undefined | Error
  /**
   * Append a user message to the chat list. This triggers the API call to fetch
   * the assistant's response.
   */
  append: (
    message: Message | CreateMessage,
    functions?: ChatCompletionFunctions[],
    function_call?: CreateChatCompletionRequestFunctionCall
  ) => Promise<string | null | undefined>
  /**
   * Reload the last AI chat response for the given chat history. If the last
   * message isn't from the assistant, it will request the API to generate a
   * new response.
   */
  reload: (functions?: ChatCompletionFunctions[], function_call?: CreateChatCompletionRequestFunctionCall) => Promise<string | null | undefined>
  /**
   * Abort the current request immediately, keep the generated tokens if any.
   */
  stop: () => void
  /**
   * Update the `messages` state locally. This is useful when you want to
   * edit the messages on the client, and then trigger the `reload` method
   * manually to regenerate the AI response.
   */
  setMessages: (messages: Message[]) => void
  /** The current value of the input */
  input: string
  /** setState-powered method to update the input value */
  setInput: React.Dispatch<React.SetStateAction<string>>
  /** An input/textarea-ready onChange handler to control the value of the input */
  handleInputChange: (e: any) => void
  /** Form submission handler to automattically reset input and append a user message  */
  handleSubmit: (e: React.FormEvent<HTMLFormElement>, functions: ChatCompletionFunctions[]) => void
  /** Whether the API request is in progress */
  isLoading: boolean
}

export type OpenAIChatRequest = {
  messages: Message[],
  functions?: Array<ChatCompletionFunctions>;
  function_call?: CreateChatCompletionRequestFunctionCall;
}

export type FunctionCallHandler = (functionCall: ChatCompletionRequestMessageFunctionCall, chatRequest: OpenAIChatRequest) => Promise<OpenAIChatRequest>;

export function useChat({
                          api = '/api/chat',
                          functionCallHandler,
                          id,
                          initialMessages = [],
                          initialInput = '',
                          sendExtraMessageFields,
                          onResponse,
                          onFinish,
                          onError,
                          headers,
                          body
                        }: UseChatOptions): UseChatHelpers {
  // Generate a unique id for the chat if not provided.
  const hookId = useId();
  const chatId = id || hookId;

  // Store the chat state in SWR, using the chatId as the key to share states.
  const { data, mutate } = useSWR<Message[]>([api, chatId], null, {
    fallbackData: initialMessages
  });
  const messages = data!;

  // Keep the latest messages in a ref.
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Abort controller to cancel the current API call.
  const abortControllerRef = useRef<AbortController | null>(null);

  const extraMetadataRef = useRef<any>({
    headers,
    body
  });
  useEffect(() => {
    extraMetadataRef.current = {
      headers,
      body
    };
  }, [headers, body]);

  // Actual mutation hook to send messages to the API endpoint and update the
  // chat state.
  const { error, trigger, isMutating } = useSWRMutation<
    string | null,
    any,
    [string, string],
    OpenAIChatRequest
  >(
    [api, chatId],
    async (_, { arg: initialChatRequest }) => {
      try {
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const getStreamedResponse = async (openAIChatRequest: OpenAIChatRequest) => {
          // Do an optimistic update to the chat state to show the updated messages
          // immediately.
          const previousMessages = messagesRef.current;
          mutate(openAIChatRequest.messages, false);

          const res = await fetch(api, {
            method: 'POST',
            body: JSON.stringify({
              messages: sendExtraMessageFields
                ? openAIChatRequest.messages
                : openAIChatRequest.messages.map(({ role, content, name, function_call }) => ({
                  role,
                  content,
                  ...(name !== undefined && { name }),
                  ...(function_call !== undefined && { function_call: function_call })
                })),
              ...extraMetadataRef.current.body,
              ...(openAIChatRequest.functions !== undefined && { functions: openAIChatRequest.functions }),
              ...(openAIChatRequest.function_call !== undefined && { function_call: openAIChatRequest.function_call })
            }),
            headers: extraMetadataRef.current.headers || {},
            signal: abortController.signal
          }).catch(err => {
            // Restore the previous messages if the request fails.
            mutate(previousMessages, false);
            throw err;
          });

          if (onResponse) {
            try {
              await onResponse(res);
            } catch (err) {
              throw err;
            }
          }

          if (!res.ok) {
            // Restore the previous messages if the request fails.
            mutate(previousMessages, false);
            throw new Error(
              (await res.text()) || 'Failed to fetch the chat response.'
            );
          }

          if (!res.body) {
            throw new Error('The response body is empty.');
          }

          let result = '';
          const createdAt = new Date();
          const replyId = nanoid();
          const reader = res.body.getReader();

          let responseMessage: Message;
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            // Update the chat state with the new message tokens.
            result += decodeAIStreamChunk(value);

            if (result.startsWith('{"function_call":')) {
            // While the function call is streaming, it will be a string.
              responseMessage = {
                id: replyId,
                createdAt,
                content: '',
                role: 'assistant',
                function_call: result
              };
            } else {
              responseMessage = {
                id: replyId,
                createdAt,
                content: result,
                role: 'assistant'
              };
            }


            mutate(
              [
                ...openAIChatRequest.messages,
                responseMessage
              ],
              false
            );

            // The request has been aborted, stop reading the stream.
            if (abortControllerRef.current === null) {
              reader.cancel();
              break;
            }
          }

          if (result.startsWith('{"function_call":')) {
            // Once the stream is complete, the function call is parsed into an object.
            const parsedFunctionCall: ChatCompletionRequestMessageFunctionCall = JSON.parse(result).function_call;
            mutate(
              [
                ...openAIChatRequest.messages,
                {
                  id: replyId,
                  createdAt,
                  content: '',
                  role: 'assistant',
                  function_call: parsedFunctionCall
                }
              ]
            );
          }

          if (onFinish) {
            // @ts-ignore
            onFinish(responseMessage);
          }
          // @ts-ignore
          return responseMessage;
        };

        let chatRequest = initialChatRequest;
        while (true) {
          await getStreamedResponse(chatRequest);
          const latestMessage = messagesRef.current[messagesRef.current.length - 1];
          if (latestMessage.function_call === undefined || typeof latestMessage.function_call === 'string') {
            break;
          }

          if (functionCallHandler) {
            const functionCall: ChatCompletionRequestMessageFunctionCall = latestMessage.function_call;
            // User handles the function call in their own functionCallHandler.
            // The arguments of the function call object will still be a string which will have to be parsed in the function handler.
            // If the JSON is malformed due to model error the user will have to handle that themselves.
            const functionCallResponseMessage: OpenAIChatRequest = await functionCallHandler(functionCall, {
              ...chatRequest,
              messages: messagesRef.current
            });
            chatRequest = functionCallResponseMessage;
          }
        }

        abortControllerRef.current = null;

        // TODO: I have no idea what needs to be returned here.
        return messagesRef.current[messagesRef.current.length - 1].content ?? '';
      } catch (err) {
        // Ignore abort errors as they are expected.
        if ((err as any).name === 'AbortError') {
          abortControllerRef.current = null;
          return null;
        }

        if (onError && err instanceof Error) {
          onError(err);
        }

        throw err;
      }
    },
    {
      populateCache: false,
      revalidate: false
    }
  );

  const append = useCallback(
    async (message: Message | CreateMessage, functions?: ChatCompletionFunctions[], function_call?: CreateChatCompletionRequestFunctionCall) => {
      if (!message.id) {
        message.id = nanoid();
      }

      const chatRequest: OpenAIChatRequest = {
        messages: messagesRef.current.concat(message as Message),
        ...(functions !== undefined && { functions }),
        ...(function_call !== undefined && { function_call })
      };

      return trigger(chatRequest);
    },
    [trigger]
  );

  const reload = useCallback(async (functions?: ChatCompletionFunctions[], function_call?: CreateChatCompletionRequestFunctionCall) => {
    if (messagesRef.current.length === 0) return null;

    const lastMessage = messagesRef.current[messagesRef.current.length - 1];
    if (lastMessage.role === 'assistant') {

      const chatRequest: OpenAIChatRequest = {
        messages: messagesRef.current.slice(0, -1),
        ...(functions !== undefined && { functions }),
        ...(function_call !== undefined && { function_call })
      };

      return trigger(chatRequest);
    }

    const chatRequest: OpenAIChatRequest = {
      messages: messagesRef.current,
      ...(functions !== undefined && { functions }),
      ...(function_call !== undefined && { function_call })
    };

    return trigger(chatRequest);
  }, [trigger]);

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const setMessages = useCallback(
    (messages: Message[]) => {
      mutate(messages, false);
      messagesRef.current = messages;
    },
    [mutate]
  );

// Input state and handlers.
  const [input, setInput] = useState(initialInput);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>, functions?: ChatCompletionFunctions[]) => {
      e.preventDefault();
      if (!input) return;
      append({
          content: input,
          role: 'user',
          createdAt: new Date()
        },
        functions);
      setInput('');
    },
    [input, append]
  );

  const handleInputChange = (e: any) => {
    setInput(e.target.value);
  };

  return {
    messages,
    error,
    append,
    reload,
    stop,
    setMessages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    isLoading: isMutating
  };
}
