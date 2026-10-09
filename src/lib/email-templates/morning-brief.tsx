import React from 'react'
import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Pick { symbol: string; grade: string; direction: string; entry: string; stop: string; target: string }
interface Props { name?: string; dateLabel?: string; picks?: Pick[]; appUrl?: string; unsubscribeUrl?: string }

const MorningBriefEmail = ({ name, dateLabel = 'today', picks = [], appUrl = 'https://www.trademindaicoach.com/signals', unsubscribeUrl = 'https://www.trademindaicoach.com/unsubscribe' }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${picks.length} setup${picks.length === 1 ? '' : 's'} on the scanner before New York opens.`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>TradeMind</Text>
        <Heading style={h1}>{name ? `Good morning, ${name}.` : 'Good morning.'}</Heading>
        <Text style={text}>Here is what the scanner is watching before New York opens on {dateLabel}.</Text>
        {picks.map((p) => (
          <Section key={p.symbol} style={card}>
            <Text style={row}><strong>{p.symbol}</strong> · {p.direction} · Grade {p.grade}</Text>
            <Text style={small}>Entry {p.entry} · Stop {p.stop} · Target {p.target}</Text>
          </Section>
        ))}
        <Text style={text}>Wait for price to reach the entry. If it does not, there is no trade.</Text>
        <Button style={button} href={appUrl}>See today's setups</Button>
        <Hr style={hr} />
        <Text style={footer}>Trade ideas only, not financial advice. Past results do not guarantee future profit.</Text>
        <Text style={footer}><Link href={unsubscribeUrl} style={unsubLink}>Unsubscribe from TradeMind emails</Link></Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: MorningBriefEmail,
  subject: (d: Record<string, any>) => `New York open: ${d.picks?.length ?? 0} setup${d.picks?.length === 1 ? '' : 's'} on the scanner`,
  displayName: 'Morning market brief',
  previewData: { name: 'Terell', dateLabel: 'Friday, Oct 9', picks: [
    { symbol: 'EUR/USD', grade: 'A', direction: 'Long', entry: '1.0842', stop: '1.0821', target: '1.0890' },
    { symbol: 'NAS100', grade: 'B', direction: 'Short', entry: '20410', stop: '20480', target: '20270' },
  ] },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Helvetica, Arial, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '520px' }
const brand = { fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#0f766e', margin: '0 0 20px' }
const h1 = { fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }
const text = { fontSize: '15px', lineHeight: '24px', color: '#334155', margin: '0 0 16px' }
const card = { backgroundColor: '#f1f5f9', borderRadius: '10px', padding: '14px 16px', margin: '0 0 10px' }
const row = { fontSize: '15px', color: '#0f172a', margin: '0 0 4px' }
const small = { fontSize: '13px', color: '#475569', margin: '0' }
const button = { backgroundColor: '#0f172a', color: '#ffffff', borderRadius: '8px', padding: '12px 20px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }
const hr = { borderColor: '#e2e8f0', margin: '28px 0 12px' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '0 0 6px' }
const unsubLink = { color: '#64748b', textDecoration: 'underline' }
