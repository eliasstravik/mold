# Contributing to Mold

Thanks for your interest in contributing!

## Development setup

```bash
git clone https://github.com/eliasstravik/mold.git
cd mold
npm install
npm run dev
```

The dev server starts with hot reload via `tsx watch`.

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes in `src/index.ts`
3. Run `npm run build` to verify TypeScript compiles cleanly
4. Test manually with `curl` or your preferred HTTP client
5. Open a pull request

## Code style

- TypeScript strict mode
- Keep it simple. The entire server is one file and should stay that way for as long as possible
- No unnecessary abstractions or dependencies

## Reporting bugs

Open an issue with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (Node version, deploy platform)
