# Dinar po dinar — redizajn interfejsa

Web i iPhone dobijaju zajednički vizuelni sistem i nov raspored. Pravila aplikacije (uloge, obračuni, rečenica predloga, upozorenja) se ne menjaju.

## Cilj

Mirno i pregledno: svetla pozadina, puno vazduha, brojevi su glavni. Član doda trošak za manje od minuta, a vlasnik na prvi pogled vidi ostatak meseca i stanje limita.

## Vizuelni sistem

Boje:

| Uloga | Vrednost |
|---|---|
| Pozadina | `#F5F6F8` |
| Površina | `#FFFFFF` |
| Tekst | `#14171C` |
| Prateći tekst | `#626B77` |
| Linije | `#E3E6EA` |
| Akcija, normalna traka limita | `#155E63` |
| Blizu limita (80–99%) | `#B7791F` |
| Preko limita, negativan ostatak | `#C0362C` |

Prihod i trošak su iste boje teksta i razlikuju se predznakom (`+` za prihod, `−` za trošak u listama).

Tipografija: web koristi Onest (latin-ext), iPhone sistemski SF Pro. Iznosi imaju `tabular-nums`. Skala 13 / 15 / 17 / 22 / 34. Osnovni tekst 16 px na vebu, 17 pt na iPhone-u.

Oblik: kartice zaobljenje 12, dugmad i polja 10, tanka linija `#E3E6EA` umesto senke, razmaci u koracima od 4 px. Fokus je uvek vidljiv (2 px obrub boje akcije). `prefers-reduced-motion` se poštuje.

Potpis: traka limita ima crticu na 80% — tačno pravilo upozorenja. Stanje trake:

- bez limita: siva traka, bez crtice
- ispod 80%: boja akcije
- 80–99%: ćilibar
- 100% i više: crvena

Stanje računa jedna funkcija u `packages/domain` (`limitState`), istim pragom kao `limitThresholds` (`spent*10 >= limit*8`, `spent >= limit`).

## Web

- Gornja traka: naziv aplikacije i domaćinstva levo; desno „Novi unos“ (glavna akcija) i „Podešavanja“ (samo vlasnik).
- Traka izbora: mesec (`‹ Septembar 2026 ›`) i čipovi osoba (`Svi`, imena).
- Kartica meseca: krupan „Ostatak“, pored njega prihod i trošak, ispod rečenica predloga.
- Dve kolone na širini od 960 px naviše: levo „Kategorije“ (trake) i „Uskoro dospeva“, desno „Unosi“. Uže od toga, jedna ispod druge.
- Upozorenja o limitu su u traci kategorije (boja i procenat). Lista upozorenja ostaje kao kratak red iznad traka, jer je to obaveza iz osnovne specifikacije.
- Unosi su grupisani po danu (zaglavlje dana, pa redovi). Vlasniku je ceo red link na izmenu; član nema link.
- Forme i prijava: jedna kolona do 560 px, oznake polja iznad, normalan tekst (bez verzala i proreda).

## iPhone

- Donja navigacija: „Pregled“ i „Unosi“, plus istaknuto dugme „+“ koje otvara novi unos kao list (modal).
- Pregled: mesec, krupan ostatak, prihod i trošak, kartica predloga, trake kategorija s crticom na 80%, „Uskoro dospeva“.
- Unosi: vodoravni čipovi filtera (osoba, kategorija, mesec), lista grupisana po danu.
- Novi unos: krupno polje iznosa, segment Trošak/Prihod, čipovi kategorija i osoba, datum s brzim izborom „Danas“ i „Juče“, beleška, prekidač ponavljanja s podsetnikom 1–7 dana, „Sačuvaj“ stalno na dnu. Neuspeh čuvanja zadržava polja i kaže „Unos nije sačuvan.“
- Prijava: ime i e-pošta, zatim šestocifreni kod.

## Van obima

Tamna tema, animacije osim kratkih prelaza stanja, nove funkcije.

## Provera

- `limitState` i grupisanje po danu imaju jedinične testove.
- Postojeći testovi i provera tipova prolaze za `web`, `mobile` i `domain`.
- Ručno: web na 1280 px i 390 px, iPhone u Expo Go-u.
