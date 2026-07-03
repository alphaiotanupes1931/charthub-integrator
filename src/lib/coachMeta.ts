import { BarChart2, Target, GraduationCap, Minus, HeartPulse, Bot, LucideIcon } from "lucide-react";

export const COACH_ICON_META: Record<string, { icon: LucideIcon; iconBg: string; iconText: string; dot: string; tagline: string }> = {
  "The Analyst": {
    icon: BarChart2,
    iconBg: "bg-blue-500/20",
    iconText: "text-blue-300",
    dot: "bg-blue-400",
    tagline: "Smart, institutional, measured.",
  },
  "The Disciplinarian": {
    icon: Target,
    iconBg: "bg-rose-500/20",
    iconText: "text-rose-300",
    dot: "bg-rose-400",
    tagline: "Rules over feelings. Always.",
  },
  "The Mentor": {
    icon: GraduationCap,
    iconBg: "bg-purple-500/20",
    iconText: "text-purple-300",
    dot: "bg-purple-400",
    tagline: "Patient, teaches the why.",
  },
  "The Minimalist": {
    icon: Minus,
    iconBg: "bg-emerald-500/20",
    iconText: "text-emerald-300",
    dot: "bg-emerald-400",
    tagline: "Fewer trades. Bigger edge.",
  },
  "The Psychologist": {
    icon: HeartPulse,
    iconBg: "bg-amber-500/20",
    iconText: "text-amber-300",
    dot: "bg-amber-400",
    tagline: "Mind first. Trade second.",
  },
};

export const DEFAULT_COACH_ICON = {
  icon: Bot,
  iconBg: "bg-muted",
  iconText: "text-primary",
  dot: "bg-primary",
  tagline: "Your active coach.",
};
