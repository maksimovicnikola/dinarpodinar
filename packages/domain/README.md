# @finance/domain

`@finance/domain` trenutno koristi source-workspace strategiju: nema build artefakata, već `exports` i `types` pokazuju direktno na `src/index.ts`.

## Package contract

- `package.json` koristi conditional exports sa `types` i `import` granama za `"."`.
- Aplikacije koje konzumiraju sirov TypeScript iz `@finance/domain` moraju da ga transpajliraju u svom build pipeline-u.
- Potrošač van `packages/domain` treba da koristi samo javni import: `@finance/domain`.

## Runtime requirements

- Okruženje mora da podržava pun `Intl` za srpski (`Intl.Collator` locale `sr`), inače sortiranje baca jasnu grešku.
- Okruženje mora da podržava vremensku zonu `Europe/Belgrade` za kalendarske datume.
- `occurredOn` se tretira kao beogradski kalendarski datum (`YYYY-MM-DD`), ne kao UTC timestamp.

## Domain assumptions

- `suggest.current` i `suggest.previous` su već jednomesečni snapshot-ovi (ne mešati više meseci u isti poziv).
- Pozivalac mora da prosledi sve kategorije koje se referenciraju u mesečnim unosima, uključujući arhivirane kategorije.
- Rast iz prethodne nule (`previousMinor <= 0`) se namerno ne računa, jer procenat rasta tada nije definisan.
