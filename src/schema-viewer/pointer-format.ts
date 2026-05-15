export function formatJsonPointerForCode(pointer: string, rootIdentifier = 'schema'): string {
  const trimmed = pointer.trim();

  if (!trimmed || trimmed === '#') {
    return rootIdentifier;
  }

  const tokens = trimmed.startsWith('#/')
    ? trimmed.slice(2).split('/').filter(Boolean)
    : trimmed.startsWith('/')
      ? trimmed.slice(1).split('/').filter(Boolean)
      : [];

  if (tokens.length === 0) {
    return rootIdentifier;
  }

  return tokens.reduce((expression, token) => {
    const decoded = token.replace(/~1/g, '/').replace(/~0/g, '~');

    if (/^(0|[1-9]\d*)$/.test(decoded)) {
      return `${expression}[${decoded}]`;
    }

    return `${expression}[${JSON.stringify(decoded)}]`;
  }, rootIdentifier);
}
