import React from 'react'
import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  name?: string
  symbol?: string
  grade?: string
  direction?: string
  entry?: string
  stop?: string
  target?: string
  confidence?: number
  modelName?: string
  appUrl?: string
  unsubscribeUrl?: string
}

const unsubLink = { color: '#64748b', textDecoration: 'underline' }

const TradeSetupEmail = ({ name, symbol = '', grade = '', direction = '', entry, stop, target, confidence, modelName, appUrl = 'https://trademindaicoach.com/dashboard', unsubscribeUrl = 'https://www.trademindaicoach.com/unsubscribe' }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${grade} ${direction} setup on ${symbol} is ready.`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>TradeMind</Text>
        <Heading style={h1}>{name ? `${name}, a ${grade} setup just formed.` : `A ${grade} setup just formed.`}</Heading>
        <Text style={text}>
          The scanner found a {grade} {direction.toLowerCase()} on {symbol}{modelName ? ` using ${modelName}` : ''}. Here is the plan.
        </Text>
        <Section style={card}>
          <Text style={label}>{symbol} · {direction}</Text>
          <Text style={big}>Grade {grade}</Text>
          {entry ? <Text style={row}>Entry: {entry}</Text> : null}
          {stop ? <Text style={row}>Stop: {stop}</Text> : null}
          {target ? <Text style={row}>Target: {target}</Text> : null}
          {confidence != null ? <Text style={row}>Conviction: {confidence}%</Text> : null}
        </Section>
        <Text style={text}>
          Check the chart and your risk before you enter. Setups go stale quickly once price moves away from the entry.
        </Text>
        <Button style={button} href={appUrl}>Review the setup</Button>
        <Hr style={hr} />
        <Text style={footer}>
          You get this email for A and B setups on the instruments you follow. This is a trade idea, not a guarantee of profit.
        </Text>
        <Text style={footer}>
          <Link href={unsubscribeUrl} style={unsubLink}>Unsubscribe from TradeMind emails</Link>
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: TradeSetupEmail,
  subject: (d: Record<string, any>) => `${d.grade ?? ''} setup: ${d.symbol ?? ''} ${d.direction ?? ''}`.trim(),
  displayName: 'New A/B trade setup',
  previewData: { name: 'Terell', symbol: 'EUR/USD', grade: 'A', direction: 'Long', entry: '1.08420', stop: '1.08180', target: '1.08900', confidence: 72, modelName: 'Classic' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Helvetica, Arial, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '520px' }
const brand = { fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#0f766e', margin: '0 0 20px' }
const h1 = { fontSize: '22px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }
const text = { fontSize: '15px', lineHeight: '24px', color: '#334155', margin: '0 0 16px' }
const card = { backgroundColor: '#f1f5f9', borderRadius: '12px', padding: '20px', margin: '8px 0 20px' }
const label = { fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: '#64748b', margin: '0' }
const big = { fontSize: '30px', fontWeight: 700, color: '#0f172a', margin: '4px 0 10px' }
const row = { fontSize: '15px', color: '#0f172a', margin: '3px 0', fontFamily: 'Menlo, Consolas, monospace' }
const button = { backgroundColor: '#0f172a', color: '#ffffff', borderRadius: '8px', padding: '12px 20px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }
const hr = { borderColor: '#e2e8f0', margin: '28px 0 12px' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '0' }
