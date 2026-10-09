import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CaretUpDownIcon } from "@phosphor-icons/react/dist/csr/CaretUpDown";
import { ChatTextIcon } from "@phosphor-icons/react/dist/csr/ChatText";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { CopySimpleIcon } from "@phosphor-icons/react/dist/csr/CopySimple";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { FilesIcon } from "@phosphor-icons/react/dist/csr/Files";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { GearIcon } from "@phosphor-icons/react/dist/csr/Gear";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { OpenAiLogoIcon } from "@phosphor-icons/react/dist/csr/OpenAiLogo";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlugIcon } from "@phosphor-icons/react/dist/csr/Plug";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { TerminalIcon } from "@phosphor-icons/react/dist/csr/Terminal";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

const icons = {
  plus: PlusIcon,
  menu: ListIcon,
  "panel-left": SidebarSimpleIcon,
  "panel-right": SidebarSimpleIcon,
  "chevron-down": CaretDownIcon,
  "chevron-right": CaretRightIcon,
  chevrons: CaretUpDownIcon,
  folder: FolderIcon,
  message: ChatTextIcon,
  settings: GearIcon,
  plug: PlugIcon,
  sparkles: SparkleIcon,
  terminal: TerminalIcon,
  stop: StopIcon,
  search: MagnifyingGlassIcon,
  branch: GitBranchIcon,
  history: ClockCounterClockwiseIcon,
  refresh: ArrowsClockwiseIcon,
  edit: PencilSimpleIcon,
  copy: CopyIcon,
  trash: TrashIcon,
  check: CheckIcon,
  files: FilesIcon,
  "arrow-up": ArrowUpIcon,
  "window-minimize": MinusIcon,
  "window-maximize": SquareIcon,
  "window-restore": CopySimpleIcon,
  close: XIcon,
  "arrow-up-right": ArrowUpRightIcon,
  info: InfoIcon,
  moon: MoonIcon,
  sun: SunIcon,
  file: FileTextIcon,
  openai: OpenAiLogoIcon,
  question: QuestionIcon,
} as const;

export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  const PhosphorIcon = icons[name];
  return <PhosphorIcon
    size={16}
    weight={name === "stop" ? "fill" : "regular"}
    style={name === "panel-right" ? { transform: "scaleX(-1)" } : undefined}
    aria-hidden="true"
  />;
}
