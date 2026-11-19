export const SHELL: string;
export function uiFiles(root?: string): string[];
export function rustFiles(root?: string): string[];
export function extractKeys(root?: string): { ui: Set<string>; rust: Set<string>; all: Set<string> };
export function findUnwrapped(root?: string): { file: string; line: number; text: string }[];
export function demoStrings(root?: string): Set<string>;
export function placeholders(s: string): string[];
export function loadEnglish(root?: string): Promise<Record<string, string>>;
export function report(root?: string): Promise<{ keys: number; missing: string[]; unused: string[]; badParams: string[]; unwrapped: { file: string; line: number; text: string }[] }>;
