import { loadDictionary } from "@/lib/i18n";
// The ES->EN dictionary is lazy in the app; tests need it synchronously.
await loadDictionary();
