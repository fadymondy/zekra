import {
  ActivityIcon,
  ArchiveIcon,
  BotIcon,
  ChartNoAxesColumnIcon,
  ClockIcon,
  DatabaseIcon,
  DownloadIcon,
  FileTextIcon,
  GlobeIcon,
  LayersIcon,
  LayoutGridIcon,
  LockIcon,
  PenToolIcon,
  PlugIcon,
  RocketIcon,
  SaveIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react"

/** The landing's icon keys: the subset of fadymondy.com-v2's IconName that zekra.dev uses. */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  activity: ActivityIcon,
  archive: ArchiveIcon,
  bot: BotIcon,
  chart: ChartNoAxesColumnIcon,
  clock: ClockIcon,
  database: DatabaseIcon,
  download: DownloadIcon,
  file: FileTextIcon,
  globe: GlobeIcon,
  layers: LayersIcon,
  layout: LayoutGridIcon,
  lock: LockIcon,
  pen: PenToolIcon,
  plug: PlugIcon,
  rocket: RocketIcon,
  save: SaveIcon,
  search: SearchIcon,
  shield: ShieldCheckIcon,
  sparkles: SparklesIcon,
  terminal: TerminalIcon,
  users: UsersIcon,
  zap: ZapIcon,
}

export function Icon({ name, className }: { name: string; className?: string }) {
  const Component = ICONS[name] ?? SparklesIcon
  return <Component className={className} />
}
