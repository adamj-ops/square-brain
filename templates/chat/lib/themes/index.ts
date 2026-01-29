/**
 * Themes Module
 *
 * Exports for the themes extraction system.
 *
 * Phase 5.3: Background compounding job (themes scanner)
 */

// Types
export {
  THEME_CATEGORIES,
  THEME_STATUSES,
  CONTENT_TYPES,
  type ThemeCategory,
  type ThemeStatus,
  type ContentType,
  type Theme,
  type ContentTheme,
  type ThemeWithEvidence,
  type ExtractedTheme,
  type ThemeScannerInput,
  type ThemeScannerResult,
} from "./types";

// Scanner
export { runThemeScanner, getThemesWithEvidence } from "./scanner";
