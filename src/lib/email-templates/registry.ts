import type { ComponentType } from 'react'
import { template as dailyProfit } from './daily-profit'
import { template as tradeSetup } from './trade-setup'
import { template as morningBrief } from './morning-brief'
import { template as scannerWins } from './scanner-wins'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 *
 * Example:
 *   import { template as welcomeTemplate } from './welcome'
 *   // then add to TEMPLATES: 'welcome': welcomeTemplate
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'daily-profit': dailyProfit,
  'trade-setup': tradeSetup,
  'morning-brief': morningBrief,
  'scanner-wins': scannerWins,
  // Add templates here as they are created, e.g.:
  // 'welcome': welcomeTemplate,
}
