import { createEmailWebhookHandler } from '@lovable.dev/email-js'
import { createFileRoute } from '@tanstack/react-router'

type Admin = { from: (t: string) => any }

async function recordOutcome(
  recipient: string,
  opts: {
    reason: 'bounce' | 'complaint' | 'unsubscribe'
    logStatus: 'bounced' | 'complained' | 'suppressed'
    note: string
    eventId: string
  },
): Promise<void> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
  const admin = supabaseAdmin as unknown as Admin
  const email = recipient.toLowerCase()

  const { error: supErr } = await admin
    .from('suppressed_emails')
    .upsert({ email, reason: opts.reason, metadata: null }, { onConflict: 'email' })
  if (supErr) {
    console.error('[email events] suppression write failed', {
      code: supErr.code,
      message: supErr.message,
      event_id: opts.eventId,
    })
    throw new Error('suppression write failed')
  }

  const { error: logErr } = await admin.from('email_send_log').insert({
    message_id: null,
    template_name: 'system',
    recipient_email: email,
    status: opts.logStatus,
    error_message: opts.note,
  })
  if (logErr) {
    console.error('[email events] send log write failed', {
      code: logErr.code,
      message: logErr.message,
      event_id: opts.eventId,
    })
    throw new Error('send log write failed')
  }

  if (opts.reason === 'unsubscribe') {
    const { error: leadErr } = await admin
      .from('marketing_leads')
      .update({ unsubscribed_at: new Date().toISOString() })
      .ilike('email', email)
    if (leadErr) {
      console.error('[email events] lead opt-out write failed', {
        code: leadErr.code,
        message: leadErr.message,
        event_id: opts.eventId,
      })
      throw new Error('lead opt-out write failed')
    }
  }
}

export const Route = createFileRoute("/lovable/email/events")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const apiKey = process.env['LOVABLE_API_KEY']
        if (!apiKey) {
          console.error('Missing required environment variables')
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }
        const handler = createEmailWebhookHandler({
          apiKey,
          on: {
            'email.bounced': async (event) => {
              await recordOutcome(event.data.recipient, {
                reason: 'bounce',
                logStatus: 'bounced',
                note: 'Address bounced and is no longer emailed',
                eventId: event.event_id,
              })
            },
            'email.complaint': async (event) => {
              await recordOutcome(event.data.recipient, {
                reason: 'complaint',
                logStatus: 'complained',
                note: 'Recipient marked an email as spam',
                eventId: event.event_id,
              })
            },
            'email.unsubscribed': async (event) => {
              await recordOutcome(event.data.recipient, {
                reason: 'unsubscribe',
                logStatus: 'suppressed',
                note: 'Recipient unsubscribed',
                eventId: event.event_id,
              })
            },
          },
        })
        return handler(request)
      },
    },
  },
})
