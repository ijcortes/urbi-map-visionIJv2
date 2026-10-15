/**
 * Drop-in Lucide → Phosphor (Fill weight) aliases.
 * App code imports from here; shadcn ui/ components keep lucide-react.
 */
import { forwardRef, type ReactNode, type SVGProps } from "react";
import { FILL, type FillIconName } from "./icons-fill.generated";

// Same props as a Phosphor icon (size/color/mirrored/alt), rendered from the
// fill-weight SVG body only. Lucide-only props (strokeWidth) and weight are
// accepted and ignored so call sites did not change.
export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref" | "children"> & {
  size?: number | string;
  color?: string;
  mirrored?: boolean;
  alt?: string;
  weight?: unknown;
  strokeWidth?: unknown;
  children?: ReactNode;
};

const fill = (name: FillIconName) => {
  const C = forwardRef<SVGSVGElement, IconProps>(function PhosphorFill(
    { size = "1em", color = "currentColor", mirrored = false, alt, weight: _w, strokeWidth: _s, children, ...rest },
    ref,
  ) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        fill={color}
        viewBox="0 0 256 256"
        transform={mirrored ? "scale(-1, 1)" : undefined}
        {...rest}
      >
        {alt ? <title>{alt}</title> : null}
        {children}
        {/* static, build-time SVG markup from @phosphor-icons/react — never user data */}
        <g dangerouslySetInnerHTML={{ __html: FILL[name] }} />
      </svg>
    );
  });
  C.displayName = name;
  return C;
};

// Lucide name → Phosphor fill
export const AlertCircle     = fill("WarningCircle");
export const AlertTriangle   = fill("Warning");
export const ArrowDown       = fill("ArrowDown");
export const ArrowLeft       = fill("ArrowLeft");
export const ArrowRight      = fill("ArrowRight");
export const ArrowUpDown     = fill("ArrowsDownUp");
export const Bath            = fill("Bathtub");
export const Bed             = fill("Bed");
export const BedDouble       = fill("Bed");
export const Building2       = fill("Buildings");
export const CalendarClock   = fill("CalendarDots");
export const Calendar        = fill("Calendar");
export const Check           = fill("Check");
export const CheckCircle     = fill("CheckCircle");
export const ChevronDown     = fill("CaretDown");
export const ChevronDownIcon = fill("CaretDown");
export const ChevronLeft     = fill("CaretLeft");
export const ChevronLeftIcon = fill("CaretLeft");
export const ChevronRight    = fill("CaretRight");
export const ChevronRightIcon = fill("CaretRight");
export const ChevronUp       = fill("CaretUp");
export const Clock           = fill("Clock");
export const ExternalLink    = fill("ArrowSquareOut");
export const Eye             = fill("Eye");
export const Flame           = fill("Fire");
export const GraduationCap   = fill("GraduationCap");
export const GripVertical    = fill("DotsSixVertical");
export const Heart           = fill("Heart");
export const HelpCircle      = fill("Question");
export const Home            = fill("House");
export const Inbox           = fill("Tray");
export const List            = fill("List");
export const Loader2         = fill("CircleNotch");
export const Lock            = fill("Lock");
export const LogOut          = fill("SignOut");
export const Mail            = fill("Envelope");
export const Map             = fill("MapTrifold");
export const MapIcon         = fill("MapTrifold");
export const MapPin          = fill("MapPin");
export const MapPinned       = fill("MapPinLine");
export const Maximize2       = fill("ArrowsOut");
export const Menu            = fill("List");
export const MessageCircle   = fill("ChatCircle");
export const Minus           = fill("Minus");
export const MoreHorizontal  = fill("DotsThree");
export const PanelLeft       = fill("SidebarSimple");
export const Plus            = fill("Plus");
export const Search          = fill("MagnifyingGlass");
export const ShieldCheck     = fill("ShieldCheck");
export const Star            = fill("Star");
export const UserPlus        = fill("UserPlus");
export const Users           = fill("Users");
export const X               = fill("X");
export const XCircle         = fill("XCircle");
export const Car             = fill("Car");
export const Layers          = fill("Stack");
// Additional icons
export const Activity        = fill("Pulse");
export const Baby            = fill("Baby");
export const Ban             = fill("Prohibit");
export const BarChart2       = fill("ChartBar");
export const Bell            = fill("Bell");
export const BellRing        = fill("BellRinging");
export const Briefcase       = fill("Briefcase");
export const Calculator      = fill("Calculator");
export const Camera          = fill("Camera");
export const ClipboardList   = fill("ClipboardText");
export const Coffee          = fill("Coffee");
export const CreditCard      = fill("CreditCard");
export const DoorClosed      = fill("Door");
export const Dumbbell        = fill("Barbell");
export const GitCompare      = fill("GitDiff");
export const Globe2          = fill("Globe");
export const History         = fill("ClockCounterClockwise");
export const Info            = fill("Info");
export const KeyRound        = fill("Key");
export const LayoutDashboard = fill("SquaresFour");
export const Leaf            = fill("Leaf");
export const Phone           = fill("Phone");
export const RotateCcw       = fill("ArrowCounterClockwise");
export const Settings        = fill("Gear");
export const Share2          = fill("ShareNetwork");
export const Shield          = fill("Shield");
export const ShieldAlert     = fill("ShieldWarning");
export const ShieldHalf      = fill("ShieldChevron");
export const ShoppingBag     = fill("ShoppingBag");
export const SlidersHorizontal = fill("Sliders");
export const Snowflake       = fill("Snowflake");
export const Sofa            = fill("Couch");
export const Sparkles        = fill("Sparkle");
export const Store           = fill("Storefront");
export const Target          = fill("Target");
export const Train           = fill("Train");
export const TrainFront      = fill("Train");
export const Trash2          = fill("Trash");
export const Trees           = fill("Tree");
export const TrendingUp      = fill("TrendUp");
export const Trophy          = fill("Trophy");
export const User            = fill("User");
export const UserSearch      = fill("UserFocus");
export const Utensils        = fill("ForkKnife");
export const UtensilsCrossed = fill("ForkKnife");
export const WashingMachine  = fill("WashingMachine");
export const Waves           = fill("Waves");
export const Wind            = fill("Wind");
export const Elevator        = fill("Elevator");
export const BookOpen        = fill("BookOpen");
export const Drop            = fill("Drop");
export const Package         = fill("Package");
export const Road            = fill("RoadHorizon");
export const Sun             = fill("Sun");
export const Binoculars      = fill("Binoculars");
export const ArrowUp         = fill("ArrowUp");
