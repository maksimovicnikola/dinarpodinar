# Porodične finansije — dizajn prve verzije

Datum: 2026-09-30

Javni naziv aplikacije je **Dinar po dinar**. Domen je `dinarpodinar.com`. U kodu, paketima i repou ostaje kratki naziv `finance`. Na ekranima, u App Store-u i na webu piše Dinar po dinar.

## Svrha

Porodica vodi zajedničku evidenciju troškova i prihoda, vidi ko je uneo šta, poredi mesec sa limitima i dobija jednu rečenicu šta vredi smanjiti.

Prva verzija služi jednom domaćinstvu. Model od prvog dana podržava više domaćinstava: svako ima svoje članove, kategorije, unose i valutu. Član jednog domaćinstva ne vidi podatke drugog.

## Zaključane odluke

- Klijenti: iPhone aplikacija u Expo-u i web u Next.js.
- Zajednička pravila i tipovi u posebnom paketu. Telefon i web dobijaju isti rezultat za isti mesec.
- Baza: Postgres preko Supabase-a, sa pravilima ko sme da vidi redove domaćinstva.
- Prijava: link na e-poštu na oba klijenta, plus Apple nalog na iPhone-u.
- Unos u prvoj verziji je ručan.
- Merenje: troškovi, prihodi i mesečni limit po kategoriji troška.
- Svi članovi vide sve unose, limite i predlog. Filter po osobi sužava prikaz.
- Član sme da doda unos. Izmenu, brisanje, kategorije, limite i pozivnice radi samo vlasnik.
- Jedan vlasnik po domaćinstvu. Vlasnik se u prvoj verziji ne uklanja.
- Jedna valuta po domaćinstvu, bira se pri otvaranju i posle se ne menja. Za prvo domaćinstvo valuta je RSD.
- Mesečna ponavljanja, sa podsetnikom pre dospeća.
- Predlog je jedna rečenica, po pravilu iz ovog dokumenta.
- Vremenska zona meseca i dospeća je Europe/Belgrade.

Povezivanje sa bankom i skeniranje fiskalnog QR koda dolaze posle ove verzije, na istom API-ju.

## Arhitektura

Monorepo:

- `apps/mobile` — Expo, unos, lista, podsetnici.
- `apps/web` — Next.js, mesečni pregled, podešavanja vlasnika.
- `packages/domain` — čiste funkcije bez mreže i bez baze: zbir meseca, pragovi 80% i 100%, rečenica predloga, dan ponavljanja u kratkom mesecu.

Supabase drži naloge, tabele i pravila pristupa. Oba klijenta zovu isti API. Otvoren ekran domaćinstva dobija nove unose čim su sačuvani. Zakazani posao ubacuje ponavljanje na dan dospeća i šalje podsetnik.

Push na iPhone stiže svim članovima domaćinstva. Na webu se isto vidi kao stavka u pregledu dospeća i limita.

## Model podataka

Iznosi su celi brojevi u najmanjoj jedinici valute (za dinar: pare). Prikaz koristi srpski zapis: tačka za hiljade, zarez za decimale, pa kod valute.

**Domaćinstvo.** Naziv, valuta, zona Europe/Belgrade.

**Članstvo.** Korisnik, domaćinstvo, uloga `owner` ili `member`. Ime za prikaz je obavezno pri prijavi.

**Kategorija.** Domaćinstvo, naziv, vrsta `expense` ili `income`, mesečni limit (samo za trošak, prazan dok ga vlasnik ne unese), arhivirana ili aktivna.

Novo domaćinstvo kreće sa troškovima Hrana, Računi, Prevoz, Zdravlje i Ostalo, i sa prihodima Plata i Ostalo. Vlasnik sme odmah da preimenuje, doda i arhivira.

**Unos.** Domaćinstvo, vrsta, iznos, kategorija, osoba, datum, beleška, ko je uneo, veza ka pravilu ponavljanja ako je nastao iz njega. Ime osobe se upisuje u unos u trenutku čuvanja. Kasnija promena imena ili izlazak člana ne menja stare unose. Promena osobe na unosu, koju radi vlasnik, upisuje novo ime.

**Ponavljanje.** Domaćinstvo, vrsta, iznos, kategorija, osoba, beleška, dan u mesecu, koliko dana ranije je podsetnik, aktivno ili ugašeno. Podsetnik je od 1 do 7 dana, podrazumevano 1.

**Pozivnica.** Domaćinstvo, e-pošta, token, ističe za 7 dana.

**Poslato obaveštenje.** Jedinstven ključ da isti prag ili isto dospeće ne ode dvaput: domaćinstvo, kategorija, mesec i prag (80 ili 100), odnosno pravilo ponavljanja, mesec i vrsta „podsetnik“.

Ostatak meseca je zbir prihoda minus zbir troškova u tom kalendarskom mesecu.

## Tokovi

1. Vlasnik se prijavi, otvori domaćinstvo i izabere valutu. Za prvo domaćinstvo to je RSD. Dobije početne kategorije.
2. Vlasnik postavi limite i pošalje pozivnicu na e-poštu. Pozvani otvori link i prijavi se istom e-poštom. Apple nalog važi kad pošalje tu e-poštu. Tada ulazi u domaćinstvo kao član.
3. Član doda unos: iznos, vrsta, kategorija, osoba, datum, beleška. Može da uključi mesečno ponavljanje i da izabere 1–7 dana podsetnika.
4. Ostali članovi vide unos na otvorenom ekranu i pri sledećem otvaranju.
5. Pregled meseca sabira kategorije, osobe i limite kroz `packages/domain`.
6. Na dan dospeća, u zoni Beograda, posao doda tačno jedan unos za to pravilo i taj mesec. Podsetnik ode ranije, jednom.

Osoba na unosu je član tog domaćinstva. Filter po osobi radi za troškove i za prihode. Limit važi za celu kategoriju troška u domaćinstvu, ne po osobi.

Član posle čuvanja vidi unos bez izmene i brisanja. Vlasnik menja i briše.

## Ekrani

**iPhone.** Početna: prihod, trošak, ostatak, kategorije na 80% ili preko, naredni podsetnici, rečenica predloga. Forma unosa. Lista sa filterom po osobi, kategoriji i mesecu.

**Web.** Isti mesečni brojevi na širem pregledu, trake kategorija naspram limita, filter po osobi, rečenica predloga. Vlasnik ovde vodi kategorije, limite, članove, pozivnice i pravila ponavljanja: iznos, dan, podsetnik i gašenje. Član vidi brojeve i dodaje unos.

Kad kategorija u mesecu prvi put pređe 80% limita, i kad prvi put pređe 100%, svi članovi dobiju jedno obaveštenje po tom pragu. Kategorija bez limita ne šalje ta obaveštenja.

## Pravilo predloga

Funkcija u `packages/domain` bira jednu kategoriju troška tekućeg meseca, ovim redom:

1. Kategorija sa najvećim prekoračenjem limita, u najmanjim jedinicama valute. Kategorija bez limita ne ulazi u ovaj korak.
2. Ako nijedna nije prešla limit, kategorija sa najvišim procentom limita, ako je taj procenat bar 80. Kategorija bez limita ne ulazi u ovaj korak.
3. Ako je sve ispod 80%, kategorija sa najvećim rastom u odnosu na prošli kalendarski mesec. Rast ulazi samo ako je bar 10% i bar apsolutni prag. Za RSD prag je 1.000,00 RSD. Za svaku drugu valutu prag je 10,00 te valute. U ovaj korak ulaze i kategorije bez limita.
4. Inače: „Ovaj mesec je unutar limita.“

Ako su dve kategorije iste po iznosu koji odlučuje, bira se ona sa većim ukupnim troškom, pa naziv po azbučnom redu srpskog jezika.

U izabranoj kategoriji imenuje se osoba sa najvećim iznosom. Ako su dve osobe iste, bira se ona sa više unosa, pa ime po azbučnom redu. Ime se ubacuje onako kako je sačuvano, bez sklanjanja.

Rečenice:

- Preko limita: „Hrana je 4.200 RSD preko limita. Najveći deo: Marko.“
- Od 80% do ispod 100%: „Prevoz je na 85% limita. Najveći deo: Ana.“
- Rast: „Potrošnja u kategoriji Računi je veća za 3.000 RSD nego prošlog meseca. Najveći deo: Ana.“
- Mirno: „Ovaj mesec je unutar limita.“

Pregled celog domaćinstva koristi rečenicu iznad. Kad je filter na jednoj osobi, grafikoni pokazuju samo nju, a rečenica je: „Marko ima najviše u kategoriji Hrana: 12.400 RSD.“ Ako su dve kategorije iste po iznosu, bira se ona sa više unosa, pa naziv po azbučnom redu. Ako ta osoba u mesecu nema trošak: „Marko nema troškove u ovom mesecu.“

Prvi mesec nema prethodni, pa važe samo koraci 1, 2 i 4.

Prihodi ne ulaze u izbor kategorije za predlog.

## Greške i granični slučajevi

- Iznos nula ili ispod nule se odbija.
- Bez mreže forma ostaje popunjena i piše da unos nije sačuvan. Nema reda za naknadnu sinhronizaciju u ovoj verziji.
- Dva istovremena unosa oba ostaju u listi.
- Zahtev člana za izmenu, brisanje, kategoriju, limit ili pozivnicu server odbija. Taj kontrolni element član ne vidi.
- Korisnik čita i piše samo u domaćinstvima u kojima je član.
- Kategorija koja ima unose se arhivira. Novi unos u arhiviranu kategoriju se odbija. Stari unosi ostaju.
- Valuta se posle otvaranja domaćinstva ne menja.
- Dan 31 u mesecu koji nema taj dan postaje poslednji dan tog meseca.
- Par pravilo i mesec daje tačno jedan automatski unos. Ponovljeni posao ne pravi duplikat.
- Podsetnik za jedno dospeće odlazi jednom. Pad posla se ponavlja bez drugog unosa i bez drugog podsetnika.
- Ručni unos pored automatskog ostaje poseban red. Vlasnik može da obriše duplikat.
- Kad vlasnik ukloni člana, taj gubi pristup odmah. Ime na starim unosima ostaje.

## Testovi

`packages/domain` ima testove za: tačno 80%, ispod 80%, preko 100%, red predloga, nerešeno između kategorija i osoba, prvi mesec, rečenicu za filter, osobu bez troška, kategoriju bez limita, prag rasta za RSD i za drugu valutu, dan 31.

API testovi proveravaju: član ne menja, ne briše i ne podešava; član ne vidi drugo domaćinstvo; vlasnik menja i briše; arhiva odbija novi unos; ponavljanje za isti mesec jednom.

Pre nego što se verzija smatra gotovom, ručno se prođe unos na iPhone-u i mesečni pregled na webu: limit, filter po osobi i predlog. Podsetnik se proveri tako što se posao pokrene za pravilo čiji je dan podsetnika danas.

## Uspeh

Vlasnik i član, u istom domaćinstvu, vide iste zbirove za isti mesec. Član doda trošak za sebe za manje od jednog minuta. Vlasnik vidi da li je kategorija prešla limit i pročita jednu rečenicu koja imenuje kategoriju i osobu po pravilu iz ovog dokumenta.
