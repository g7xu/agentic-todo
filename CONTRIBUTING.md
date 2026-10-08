# Contributing

Issues and pull requests are welcome. This is a one-person project, so replies can take a few
days.

## Running it locally

You need Node.js 22+ and your own [Neon](https://neon.com) project with Neon Auth enabled; the
app's database and sign-in both live there.

```bash
npm install
cp .env.local.example .env.local   # fill in your Neon values; APP_URL must match the dev URL
npm run dev -- -p 3001
```

`npm test` runs the unit tests. The end-to-end suites need a running server and a development
database; see [tests/e2e/README.md](tests/e2e/README.md).

## Before opening a pull request

- `npm run lint` and `npm test` pass.
- One change per pull request, with the reason in the description.
- Changes to the MCP tool surface or the OAuth flow should update [docs/MCP.md](docs/MCP.md),
  and the OAuth smoke test should still pass.

## Design notes

[docs/](docs/) holds the specs the code refers to; [docs/design/](docs/design/) holds the
product requirements, technical design and decision log the project was built from.

## License

By contributing you agree that your contribution is licensed under the project's
[MIT License](LICENSE).
