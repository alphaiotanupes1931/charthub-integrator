import React from 'react'
import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Win { symbol: string; direction: string; grade?: string; r: string }
interface Props { name?: string; dateLabel?: string; wins?: Win[]; appUrl?: string; unsubscribeUrl?: string }

const ScannerWinsEmail = ({ name, dateLabel = 'today', wins = [], appUrl = 'https://www.trademindaicoach.com/journal', unsubscribeUrl = 'https://www.trademindaicoach.com/unsubscribe' }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${wins.length} scanner setup${wins.length === 1 ? '' : 's'} hit target ${dateLabel}.`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>TradeMind</Text>
        <Heading style={h1}>{name ? `${name}, the scanner hit today.` : 'The scanner hit today.'}</Heading>
        <Text style={text}>These setups reached their target on {dateLabel}. Did you catch them?</Text>
        <Section style={card}>
          {wins.map((w) => (
            <Text key={w.symbol + w.direction} style={row}>
              <strong>{w.symbol}</strong> {w.direction}{w.grade ? ` · ${w.grade}` : ''} · <span style={green}>+{w.r}R</span>
            </Text>
          ))}
        </Section>
        <Text style={text}>Open your journal to see what triggered each entry, so you are ready for the next one.</Text>
        <Button style={button} href={appUrl}>Review today's scans</Button>
        <Hr style={hr} />
        <Text style={footer}>R is profit measured in units of the risk taken. Past results do not guarantee future profit.</Text>
        <Text style={footer}><Link href={unsubscribeUrl} style={unsubLink}>Unsubscribe from TradeMind emails</Link></Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ScannerWinsEmail,
  subject: (d: Record<string, any>) => `${d.wins?.length ?? 0} scanner setup${d.wins?.length === 1 ? '' : 's'} hit target today`,
  displayName: 'Scanner wins recap',
  previewData: { name: 'Terell', dateLabel: 'Thursday, Oct 8', wins: [
    { symbol: 'GBP/USD', direction: 'Short', grade: 'A', r: '2.1' },
    { symbol: 'EUR/USD', direction: 'Long', grade: 'B', r: '1.4' },
  ] },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Helvetica, Arial, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '520px' }
const brand = { fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#0f766e', margin: '0 0 20px' }
const h1 = { fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }
const text = { fontSize: '15px', lineHeight: '24px', color: '#334155', margin: '0 0 16px' }
const card = { backgroundColor: '#f0fdf4', borderRadius: '12px', padding: '16px 18px', margin: '8px 0 20px' }
const row = { fontSize: '15px', color: '#0f172a', margin: '0 0 6px' }
const green = { color: '#15803d', fontWeight: 700 }
const button = { backgroundColor: '#0f172a', color: '#ffffff', borderRadius: '8px', padding: '12px 20px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }
const hr = { borderColor: '#e2e8f0', margin: '28px 0 12px' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '0 0 6px' }
const unsubLink = { color: '#64748b', textDecoration: 'underline' }
