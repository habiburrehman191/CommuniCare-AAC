import { Plus, Minus, Link2, Clock3, MapPinned, ThermometerSun, Snowflake, Angry, MoveRight, Gauge, Brain, Frown } from 'lucide-react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Award,
  BadgeCheck,
  Bath,
  Bed,
  BellRing,
  BookOpen,
  Car,
  CircleCheck,
  CircleX,
  Clock,
  CloudRain,
  Coffee,
  CupSoda,
  Droplets,
  Gamepad2,
  Hand,
  Heart,
  HeartHandshake,
  HeartPulse,
  HelpCircle,
  Home,
  Hospital,
  Languages,
  MapPin,
  MessageCircle,
  Mic,
  Moon,
  Music,
  OctagonX,
  PhoneCall,
  Pill,
  Play,
  RotateCcw,
  School,
  ShieldAlert,
  Siren,
  Smile,
  Sparkles,
  Stethoscope,
  Trees,
  Tv,
  UserRound,
  UserRoundCheck,
  Users,
  UsersRound,
  Utensils,
  Volume2,
  Wind,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PhraseCategory } from '@/types';

// Complete dictionary of semantic, accessible AAC icons strictly via lucide-react
export const iconMap: Record<string, LucideIcon> = {
  // Basic Needs
  CircleCheck,
  CircleX,
  Bath,
  HelpCircle,
  Zap,
  Sparkles,

  // Food and Drink
  Droplets,
  Utensils,
  CupSoda,
  Coffee,

  // Health
  Activity,
  Pill,
  Stethoscope,
  Hospital,
  HeartPulse,
  Lungs: Wind,

  // Emotions
  Smile,
  CloudRain,
  ShieldAlert,
  Heart,

  // Places
  Home,
  School,
  Trees,
  MapPin,
  Car,

  // Social
  Hand,
  HeartHandshake,
  BadgeCheck,
  MessageCircle,

  // Emergency
  Siren,
  AlertTriangle,
  AlertOctagon,
  BellRing,
  PhoneCall,

  // Family & People
  UserRound,
  UserRoundCheck,
  UsersRound,
  Users,

  // Actions
  Bed,
  Gamepad2,
  OctagonX,
  Play,
  BookOpen,
  Tv,
  Music,
  Moon,
  RotateCcw,
  Clock,
  Volume2,
  Languages,
  Mic,
  Award,
};

const symbolIcons: Record<string, LucideIcon> = {
 'basic-more':Plus, 'basic-less':Minus, 'basic-and':Link2, 'basic-now':Clock3, 'basic-at':MapPinned,
 'basic-very':Gauge, 'health-hot':ThermometerSun, 'health-cold':Snowflake, 'health-headache':Brain,
 'emotions-angry':Angry, 'emotions-sad':Frown, 'actions-go':MoveRight,
};
export function getPhraseIcon(iconName: string, phraseId?: string): LucideIcon {
 return (phraseId && symbolIcons[phraseId]) || iconMap[iconName] || CircleCheck;
}

// Category icons for navigation tabs & banners
export const categoryIconMap: Record<PhraseCategory, LucideIcon> = {
  'Basic Needs': Zap,
  'Food and Drink': Utensils,
  Health: HeartPulse,
  Emotions: Smile,
  Places: MapPin,
  Social: MessageCircle,
  Emergency: AlertTriangle,
  Family: Users,
  Actions: Activity,
};

export function getCategoryIcon(category: PhraseCategory): LucideIcon {
  return categoryIconMap[category] ?? MessageCircle;
}

