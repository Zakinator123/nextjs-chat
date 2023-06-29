import {Button} from '@/components/ui/button'
import {PromptForm} from '@/components/prompt-form'
import {ButtonScrollToBottom} from '@/components/button-scroll-to-bottom'
import {IconRefresh, IconStop} from '@/components/ui/icons'
import {FooterText} from '@/components/footer'
import {ChatCompletionFunctions} from "openai-edge";
import {UseChatHelpers} from "ai/react/dist";

const functions: ChatCompletionFunctions[] = [
    {
        name: 'get_current_weather',
        description: 'Get the current weather',
        parameters: {
            type: 'object',
            properties: {
                location: {
                    type: 'string',
                    description: 'The city and state, e.g. San Francisco, CA'
                },
                format: {
                    type: 'string',
                    enum: ['celsius', 'fahrenheit'],
                    description:
                        'The temperature unit to use. Infer this from the users location.'
                }
            },
            required: ['location', 'format']
        }
    },
    {
        name: 'get_current_time',
        description: 'Get the current time',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'eval_code_in_browser',
        description: 'Execute javascript code in the browser with eval().',
        parameters: {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: `Javascript code that will be directly executed via eval(). Do not use backticks in your response.
           DO NOT include any newlines in your response, and be sure to provide only valid JSON when providing the arguments object.
           The output of the eval() will be returned directly by the function.`
                }
            },
            required: ['code']
        }
    }
]

export interface ChatPanelProps
    extends Pick<
        UseChatHelpers,
        | 'append'
        | 'isLoading'
        | 'reload'
        | 'messages'
        | 'stop'
        | 'input'
        | 'setInput'
    > {
    id?: string
}

export function ChatPanel({
                              id,
                              isLoading,
                              stop,
                              append,
                              reload,
                              input,
                              setInput,
                              messages
                          }: ChatPanelProps) {
    return (
        <div className="fixed inset-x-0 bottom-0 bg-gradient-to-b from-muted/10 from-10% to-muted/30 to-50%">
            <ButtonScrollToBottom/>
            <div className="mx-auto sm:max-w-2xl sm:px-4">
                <div className="flex h-10 items-center justify-center">
                    {isLoading ? (
                        <Button
                            variant="outline"
                            onClick={() => stop()}
                            className="bg-background"
                        >
                            <IconStop className="mr-2"/>
                            Stop generating
                        </Button>
                    ) : (
                        messages?.length > 0 && (
                            <Button
                                variant="outline"
                                onClick={() => reload()}
                                className="bg-background"
                            >
                                <IconRefresh className="mr-2"/>
                                Regenerate response
                            </Button>
                        )
                    )}
                </div>
                <div className="space-y-4 border-t bg-background px-4 py-2 shadow-lg sm:rounded-t-xl sm:border md:py-4">
                    <PromptForm
                        onSubmit={async value => {
                            await append({
                                    id,
                                    content: value,
                                    role: 'user'
                                },
                                {functions})
                        }}
                        input={input}
                        setInput={setInput}
                        isLoading={isLoading}
                    />
                    <FooterText className="hidden sm:block"/>
                </div>
            </div>
        </div>
    )
}
