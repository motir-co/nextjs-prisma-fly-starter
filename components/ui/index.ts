/**
 * The Motir design-system UI primitives, re-exported so app code can import
 * them from the conventional `@/components/ui` path:
 *
 *   import { Button, Card, Modal } from '@/components/ui';
 *
 * These are THIN re-exports of `@motir/design-system` — there is NO hand-copied
 * primitive source in this repo. The package (versioned on npm) is the single
 * source of truth, so a scaffolded product stays in lockstep with motir-core's
 * design system and can never drift into a second copy (notes.html #18).
 * Importing directly from `@motir/design-system` works identically; this barrel
 * exists only for the familiar `@/components/ui/*` ergonomics.
 *
 * (The theme registries, apply API, provider, and pickers live at the package
 * root — import those from `@motir/design-system` directly.)
 */
export {
  Button,
  type ButtonProps,
  buttonVariants,
  Card,
  type CardProps,
  Input,
  type InputProps,
  Textarea,
  type TextareaProps,
  FormField,
  type FormFieldProps,
  describedById,
  Modal,
  type ModalProps,
  Pill,
  type PillProps,
  Popover,
  type PopoverProps,
  type PopoverContentProps,
  Combobox,
  type ComboboxOption,
  type ComboboxProps,
  SectionLabel,
  type SectionLabelProps,
  Segmented,
  type SegmentedOption,
  Switch,
  type SwitchProps,
  Spinner,
  type SpinnerProps,
  Tooltip,
  type TooltipProps,
  ToastProvider,
  useToast,
  EmptyState,
  type EmptyStateProps,
  ErrorState,
  type ErrorStateProps,
  MultiSelectPicker,
  type MultiSelectPickerProps,
  type MultiSelectOption,
  ColorSwatchPicker,
  type ColorSwatchPickerProps,
  type ColorSwatchOption,
  STATUS_COLOR_SWATCHES,
} from '@motir/design-system';
