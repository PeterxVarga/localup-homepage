// ESM resolve loader for node:test + type stripping.
// Node's ESM resolver does not look up extensionless .ts imports by default.
// This loader appends .ts to relative specifiers when no extension is present,
// so the production code can keep using normal extensionless TypeScript imports.

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

function hasExtension(specifier) {
  return specifier.includes('.') && /\.[^./]+$/.test(specifier);
}

function isRelative(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

export async function resolve(specifier, context, nextResolve) {
  if (isRelative(specifier) && !hasExtension(specifier)) {
    for (const ext of EXTENSIONS) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch {
        // try next extension
      }
    }
  }

  return nextResolve(specifier, context);
}
