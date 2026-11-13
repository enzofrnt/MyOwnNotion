import {
  NUMBER_FORMAT_CURRENCY,
  NUMBER_FORMATS,
  type NumberFormat,
  type NumberPropertyConfig,
} from "@myownnotion/domain";
import { DATABASE_LOCALE } from "./database-copy.ts";

const numberFormatNames = new Intl.DisplayNames([DATABASE_LOCALE], { type: "currency" });

export function numberFormatLabel(format: NumberFormat): string {
  if (format === "number") return "Nombre";
  if (format === "number_with_separators") return "Nombre avec séparateurs";
  if (format === "percent") return "Pourcentage";
  const currency = NUMBER_FORMAT_CURRENCY[format];
  if (currency === null) return format;
  if (format === "bitcoin") return "Bitcoin (BTC)";
  const name = numberFormatNames.of(currency) ?? currency;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} (${currency})`;
}

export const NUMBER_FORMAT_OPTIONS = NUMBER_FORMATS.map((format) => ({
  value: format,
  label: numberFormatLabel(format),
}));

function fractionDigits(canonical: string): number {
  const fraction = canonical.split(".")[1];
  return fraction === undefined ? 0 : fraction.length;
}

function decimalParts(config: NumberPropertyConfig): Intl.NumberFormatOptions {
  if (config.decimals !== "default") {
    return { minimumFractionDigits: config.decimals, maximumFractionDigits: config.decimals };
  }
  return {};
}

export function formatDatabaseNumber(canonical: string, config: NumberPropertyConfig): string {
  const value = Number(canonical);
  if (!Number.isFinite(value)) return canonical;
  const currency = NUMBER_FORMAT_CURRENCY[config.format];
  const style =
    config.format === "percent" ? "percent" : currency === null ? "decimal" : "currency";
  const grouping = config.format !== "number";
  const options: Intl.NumberFormatOptions = {
    style,
    useGrouping: grouping,
    ...decimalParts(config),
  };
  if (config.decimals === "default") {
    if (style === "decimal") {
      options.maximumFractionDigits = fractionDigits(canonical);
      options.minimumFractionDigits = 0;
    } else if (style === "percent") {
      options.maximumFractionDigits = 2;
      options.minimumFractionDigits = 0;
    }
  }
  if (style === "currency" && currency !== null) {
    options.currency = currency;
    options.currencyDisplay = "symbol";
  }
  try {
    return new Intl.NumberFormat(DATABASE_LOCALE, options).format(value);
  } catch {
    return `${new Intl.NumberFormat(DATABASE_LOCALE, { maximumFractionDigits: 2 }).format(value)} ${currency ?? ""}`.trim();
  }
}
