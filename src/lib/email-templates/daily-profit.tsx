import React from 'react'
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  name?: string
  pnl?: string
  dateLabel?: string
  trades?: number
  wins?: number
  bestSymbol?: string
  bestPnl?: string
  balance?: string
  appUrl?: string
}

const DailyProfitEmail = ({ name, pnl = '', dateLabel = 'today', trades = 0, wins = 0, bestSymbol, bestPnl, balance, appUrl = 'https://trademindaicoach.com/dashboard' }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`You finished ${dateLabel} up ${pnl}.`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>TradeMind</Text>
        <Heading style={h1}>{name ? `Nice work, ${name}.` : 'Nice work.'}</Heading>
        <Text style={text}>You closed {dateLabel} in profit.</Text>
        <Section style={card}>
          <Text style={label}>Made today</Text>
          <Text style={big}>+{pnl}</Text>
          <Text style={small}>
            {trades} closed {trades === 1 ? 'trade' : 'trades'}, {wins} {wins === 1 ? 'winner' : 'winners'}
          </Text>
          {bestSymbol && bestPnl ? <Text style={small}>Best trade: {bestSymbol} +{bestPnl}</Text> : null}
          {balance ? <Text style={small}>Account balance: {balance}</Text> : null}
        </Section>
        <Text style={text}>
          Green days come from following the plan, not from forcing more trades. Protect today's gains and come back fresh tomorrow.
        </Text>
        <Button style={button} href={appUrl}>Open TradeMind</Button>
        <Hr style={hr} />
        <Text style={footer}>You get this email only on days you finish in profit. You can turn it off in Settings.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: DailyProfitEmail,
  subject: (d: Record<string, any>) => `You made +${d.pnl ?? ''} today`,
  displayName: 'Daily profit recap',
  previewData: { name: 'Terell', pnl: '$342.50', dateLabel: 'Thursday, Oct 8', trades: 3, wins: 2, bestSymbol: 'EUR/USD', bestPnl: '$280.10', balance: '$100,342.50' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Helvetica, Arial, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '520px' }
const brand = { fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#0f766e', margin: '0 0 20px' }
const h1 = { fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }
const text = { fontSize: '15px', lineHeight: '24px', color: '#334155', margin: '0 0 16px' }
const card = { backgroundColor: '#f0fdf4', borderRadius: '12px', padding: '20px', margin: '8px 0 20px' }
const label = { fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: '#64748b', margin: '0' }
const big = { fontSize: '36px', fontWeight: 700, color: '#15803d', margin: '4px 0 8px' }
const small = { fontSize: '14px', color: '#334155', margin: '2px 0' }
const button = { backgroundColor: '#0f172a', color: '#ffffff', borderRadius: '8px', padding: '12px 20px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }
const hr = { borderColor: '#e2e8f0', margin: '28px 0 12px' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '0' }
