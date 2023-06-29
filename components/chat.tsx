'use client'


import {cn} from '@/lib/utils'
import {ChatList} from '@/components/chat-list'
import {ChatPanel} from '@/components/chat-panel'
import {EmptyScreen} from '@/components/empty-screen'
import {ChatScrollAnchor} from '@/components/chat-scroll-anchor'
import {useLocalStorage} from '@/lib/hooks/use-local-storage'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import React, {useState} from 'react'
import {Button} from './ui/button'
import {Input} from './ui/input'
import {ChatRequest, FunctionCallHandler, Message, nanoid} from "ai";
import {useChat} from "ai/react";

const IS_PREVIEW = process.env.VERCEL_ENV === 'preview'

export interface ChatProps extends React.ComponentProps<'div'> {
    initialMessages?: Message[]
    id?: string
}


export function Chat({id, initialMessages, className}: ChatProps) {
    const [previewToken, setPreviewToken] = useLocalStorage<string | null>(
        'ai-token',
        null
    )
    const [previewTokenDialog, setPreviewTokenDialog] = useState(IS_PREVIEW)
    const [previewTokenInput, setPreviewTokenInput] = useState(previewToken ?? '')

    const functionCallHandler: FunctionCallHandler = async (
        chatMessages,
        functionCall
    ) => {
        if (functionCall.name === 'get_current_weather') {
            if (functionCall.arguments) {
                const parsedFunctionCallArguments = JSON.parse(functionCall.arguments)
                // You now have access to the parsed arguments here (assuming the JSON was valid)
                // If JSON is invalid, return an appropriate message to the model so that it may retry?
                console.log(parsedFunctionCallArguments)
            }

            // Generate a fake temperature
            const temperature = Math.floor(Math.random() * (100 - 30 + 1) + 30)
            // Generate random weather condition
            const weather = ['sunny', 'cloudy', 'rainy', 'snowy'][
                Math.floor(Math.random() * 4)
                ]

            const functionResponse: ChatRequest = {
                messages: [
                    ...chatMessages,
                    {
                        id: nanoid(),
                        name: 'get_current_weather',
                        role: 'function' as const,
                        content: JSON.stringify({
                            temperature,
                            weather,
                            info: 'This data is randomly generated and came from a fake weather API!'
                        })
                    }
                ]
            }
            return functionResponse
        } else if (functionCall.name === 'get_current_time') {
            const time = new Date().toLocaleTimeString()
            const functionResponse: ChatRequest = {
                messages: [
                    ...chatMessages,
                    {
                        id: nanoid(),
                        name: 'get_current_time',
                        role: 'function' as const,
                        content: JSON.stringify({time})
                    }
                ]
                // You can also (optionally) return a list of functions here that the model can call next
                // functions
            }

            return functionResponse
        } else if (functionCall.name === 'eval_code_in_browser') {
            if (functionCall.arguments) {
                // Parsing here does not always work since it seems that some characters in generated code aren't escaped properly.
                const parsedFunctionCallArguments: { code: string } = JSON.parse(
                    functionCall.arguments
                )
                const functionResponse = {
                    messages: [
                        ...chatMessages,
                        {
                            id: nanoid(),
                            name: 'eval_code_in_browser',
                            role: 'function' as const,
                            content: JSON.stringify(eval(parsedFunctionCallArguments.code))
                        }
                    ]
                }
                return functionResponse
            }
        }
    }


    const {messages, append, reload, stop, isLoading, input, setInput} =
        useChat({
            experimental_onFunctionCall: functionCallHandler,
            initialMessages,
            id,
            body: {
                id,
                previewToken
            }
        })
    return (
        <>
            <div className={cn('pb-[200px] pt-4 md:pt-10', className)}>
                {messages.length ? (
                    <>
                        <ChatList messages={messages}/>
                        <ChatScrollAnchor trackVisibility={isLoading}/>
                    </>
                ) : (
                    <EmptyScreen setInput={setInput}/>
                )}
            </div>
            <ChatPanel
                id={id}
                isLoading={isLoading}
                stop={stop}
                append={append}
                reload={reload}
                messages={messages}
                input={input}
                setInput={setInput}
            />

            <Dialog open={previewTokenDialog} onOpenChange={setPreviewTokenDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Enter your OpenAI Key</DialogTitle>
                        <DialogDescription>
                            If you have not obtained your OpenAI API key, you can do so by{' '}
                            <a
                                href="https://platform.openai.com/signup/"
                                className="underline"
                            >
                                signing up
                            </a>{' '}
                            on the OpenAI website. This is only necessary for preview
                            environments so that the open source community can test the app.
                            The token will be saved to your browser&apos;s local storage under
                            the name <code className="font-mono">ai-token</code>.
                        </DialogDescription>
                    </DialogHeader>
                    <Input
                        value={previewTokenInput}
                        placeholder="OpenAI API key"
                        onChange={e => setPreviewTokenInput(e.target.value)}
                    />
                    <DialogFooter className="items-center">
                        <Button
                            onClick={() => {
                                setPreviewToken(previewTokenInput)
                                setPreviewTokenDialog(false)
                            }}
                        >
                            Save Token
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
