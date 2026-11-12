# AeroPlan 2.12 — symulacja PM₂.₅ i przepływu w mieszkaniu

AeroPlan to lokalna aplikacja HTML/CSS/JS do rysowania planu mieszkania, porównania różnych lokalizacji oczyszczacza powietrza i sprawdzenia wpływu wentylacji. Od wersji 2.7 korzysta z **dwóch powiązanych uproszczonych modeli**:

1. **Wielostrefowy model ciśnień i przepływów** (pokoje jako węzły, okna i drzwi jako opory, nawiew/wywiew, ciśnienie wiatru na elewacji, bilans masowy). Kod w `airflow-network.js`.
2. **Lokalny dwuwymiarowy model transportu zanieczyszczeń**: pole prędkości na siatce, adwekcja–dyfuzja i bilans PM₂.₅, dopływ z zewnątrz, źródła pyłu, osadzanie i filtracja CADR. Kod w `app.js`.

> **Nie jest to walidowane CFD 3D, rzeczywisty pomiar ani program projektowania instalacji wentylacyjnych.** Podane wartości ciśnień, prędkości, lokalnych stężeń i rankingi są orientacyjne. Bez danych o budynku, wietrze, meblach i urządzeniach nie ma podstaw do deklarowania dokładności absolutnej.

## Nowość 2.12 — zapisz raz, korzystaj wielokrotnie

W sekcji **7. Zapis i odczyt** znajdują się teraz:

- **Zapisz projekt:** wpisz nazwę i zapisz kompletny układ mieszkania wraz z pozycją i parametrami oczyszczacza, pokojami, drzwiami, oknami, kratkami wentylacyjnymi oraz scenariuszem PM₂.₅ / wiatru. Można mieć do **20 nazwanych projektów**, np. różne rozważane oczyszczacze.
- **Wczytaj wybrany:** wybierz projekt z listy i potwierdź zastąpienie aktualnej konfiguracji. Wczytanie korzysta z tej samej walidacji i transakcyjnego importu, co JSON.
- **Usuń wybrany zapis:** usuwa tylko wybraną kopię projektu, nie zmieniając bieżącego planu.
- **Automatyczne przywracanie ostatniej konfiguracji:** zmiany parametrów i elementów planu są zapisywane w pamięci przeglądarki i przywracane przy następnym otwarciu aplikacji. Automatyczny zapis nie zawiera bieżącej klatki symulacji, czasu ani historycznych wyników rankingu.
- **Eksport/import JSON:** niezależny, przenośny plik zapasowy, zgodny z wcześniejszym formatem v7.

**Ważne:** projekty w pamięci przeglądarki (`localStorage`) są zapisane **wyłącznie na urządzeniu, w danej przeglądarce i dla tego samego adresu strony / pliku**. Nie synchronizują się pomiędzy telefonem i komputerem. Czyszczenie danych przeglądarki, tryb prywatny oraz przeniesienie lub zmiana nazwy lokalnego pliku HTML mogą uniemożliwić dostęp do zapisów. `file://` ma zależne od przeglądarki zasady przechowywania; jeśli pamięć nie działa, interfejs wyświetla komunikat i nadal można korzystać z plików JSON. **Regularnie eksportuj JSON na dysk, zwłaszcza przed wymianą wersji AeroPlan.**

Dodatkowe testy przeglądarkowe sprawdzają named projects, zastępowanie, przywrócenie sesji, zapamiętanie geometrii i CADR, błędny zapis, brak miejsca oraz niedostępną pamięć. Środowisko testowe ogranicza nawigację HTTP i `file://`, więc testy trwałości używają odpowiednika interfejsu Web Storage zachowującego zawartość między świeżymi stronami; nie stanowią potwierdzenia konkretnej polityki `file://` każdej przeglądarki.

## Uruchomienie

1. Pobierz `index.html`, `styles.css`, `airflow-network.js`, `app.js` do jednego folderu.
2. Otwórz `index.html` w nowej przeglądarce. Nic nie trzeba instalować; aplikacja działa offline.
3. Do rozwoju można użyć `python -m http.server 8000`.

## Stabilizacja 2.11 — końcowe poprawki kodu po audycie

- Walidacja importu JSON jest transakcyjna: błędne zakresy, nieistniejące pomieszczenia, nakładające się przejścia i niepoprawna geometria nie zastępują prawidłowego planu. Zachowano import starszych, prawidłowych projektów.
- Połączono trzy nasłuchiwacze ruchu myszy w jeden kontroler, bez zmiany sposobu rysowania i przesuwania.
- Ranking oblicza średnią ekspozycję metodą trapezów w każdym kroku czasowym; wynik nie zależy już od arbitralnej częstotliwości próbkowania co 15 kroków. Wybór pozycji z rankingu zachowuje czas i stężenia.
- Poprawiono wygładzenie równania przepływu przy zerowej różnicy ciśnień, zgodnie z pochodną w solverze Newtona; dodano testy aproksymacji prawa przepływu.
- Naprawiono blokowanie rankingu przy nierozwiązywalnej wentylacji i kilka przypadków błędnej edycji drzwi oraz geometrii pokoi.
- Pełna tabela statusów C1–C12 i L1–L7: **[AUDIT-RESOLUTION.md](AUDIT-RESOLUTION.md)**.

**Nie jest to przejście na zweryfikowane CFD 3D.** Niedokładności współczynników naporu wiatru, rozkładu pionowego i aerodynamiki oczyszczacza pozostają jawne; ich wyeliminowanie wymaga rozszerzenia modelu, nie poprawy JavaScript. Sam wybór pierwszego oczyszczacza nie wymaga własnych pomiarów, jednak wyniki powinny być oceniane scenariuszowo.

### Nowe w 2.9 — nieszczelność zamkniętych drzwi

- Zamknięte drzwi nie są traktowane jako szczelna bariera: sieć ciśnień przepuszcza powietrze przez szczelinę pod skrzydłem oraz równoważną nieszczelność przy ościeżnicy. Model PM₂.₅ i przepuszczalność krawędzi siatki są aktualizowane wraz ze stanem drzwi.
- Parametry edytowane osobno dla każdych drzwi: **wysokość szczeliny 0–35 mm** oraz **dodatkowy przekrój nieszczelności ościeżnicy 0–200 cm²**. Domyślnie **10 mm i 4 cm²**; to scenariuszowy punkt startowy, **nie pomiar** ani cecha wszystkich drzwi.
- Dla drzwi o szerokości 80 cm szczelina 10 mm daje 80 cm² podcięcia (plus domyślne, orientacyjne 4 cm² nieszczelności ościeżnicy). W polskich wytycznych wentylacji zalecane jest co najmniej **80 cm²** transferu dla pokojów i **200 cm²** dla kuchni i pomieszczeń sanitarnych; rzeczywisty przepływ zależy również od różnicy ciśnień.
- Dla zamkniętych drzwi używane jest równanie otworu `Q = C_d × A × √(2|Δp|/ρ)`, gdzie `C_d=0,6`, `ρ=1,204 kg/m³`. To przybliżenie dla szczeliny; nie jest wynikiem badania szczelności konkretnych drzwi ani geometrycznie wierną symulacją strugi pod skrzydłem.
- **Domyślnie zachowane są aktualne stężenia i czas** po zmianie parametrów. JSON **v7** zapisuje właściwości drzwi; starsze JSON automatycznie dostają domyślne wartości. Ustawienie obu parametrów na 0 dopuszcza model drzwi w pełni uszczelnionych.
- Przy bardzo drobnej siatce drzwiowe szczeliny są reprezentowane jako **ułamkowo przepuszczalna granica komórek**; pionowa geometria szczeliny nadal nie jest rozwiązywana w 3D. Od wersji 2.10 sumaryczny strumień drzwiowy z sieci ciśnień jest wymuszany na odpowiadających mu krawędziach siatki 2D.

Źródła: [Stowarzyszenie Polska Wentylacja — wytyczne stolarki wewnętrznej](https://www.wentylacja.org.pl/upload/files/GT_domy_jednorodzinne/SPWWytyczneRekuperacja.pdf) i [wymagania normowe](https://www.wentylacja.org.pl/pages-62.html); [CIBSE Guide A — właściwości przepływowe drzwi](https://ierga.com/wp-content/uploads/sites/2/2017/10/CIBSE-Guide-A-Environmental-design.pdf).

## Runda korekt fundamentu 2.10 (audyt niezależny)

**Naprawione i testowane:**

1. Przeniesienie oczyszczacza zachowuje czas, aktualne pola PM₂.₅ i sumę usuniętego pyłu; ponownie oblicza jedynie kierunek/pole wydmuchu i pobór filtra.
2. Usunięto nakładanie się mechanizmów napływu z nieszczelności: ACH występuje **tylko jako przepuszczalność ciśnieniowa obudowy**. Penetracja PM jest naliczana przy odpowiednich zewnętrznych strumieniach napływu, nie przy odpływie.
3. Każdy otwór drzwiowy, także szczelina pod zamkniętymi drzwiami, uzyskuje **sumaryczny strumień na siatce 2D zgodny ze strumieniem sieci ciśnień**. Projekcja modyfikuje prędkości tylko wewnątrz pokojów, nie na narzuconych krawędziach przejść.
4. Zlikwidowano sztuczne skalowanie wszystkich prędkości do 1,25 m/s; ograniczenie stabilności odbywa się przez krok czasowy. Import i konfiguracja kontrolują zmianę kroku siatki; jeżeli nie da się odwzorować przejścia o niezerowym strumieniu, aplikacja ostrzega zamiast udawać dokładność.
5. Okna pozostają aktywne w sieci wiatrowej także gdy referencyjne Δp = 0 Pa; limit wymiany 0 m³/h dla otwartego okna jest respektowany. Ujednolicono rho = 1,204 kg/m³.
6. Poprawiono opis nawiewu **brutto**, numerację sekcji, domyślne wartości HTML i ograniczenie szerokości drzwi. Pokazano skumulowaną korektę ujemnych stężeń (powinna pozostać zerowa); ujednolicono import.
7. Ranking otrzymuje świeży, **niezależny** stan ciśnień dla wspólnego scenariusza wiatru bez podmuchów i jednakowy stan początkowy dla każdego ustawienia. W scenariuszu dwóch pokojów z dwoma oknami po przeciwnych stronach siatki 0,30 / 0,20 / 0,15 m zachowały kolejność dwóch ustawień, a dawki różniły się o mniej niż 1,5% w teście 180 s.

**Ważne:** to kontrola spójności obliczeń, a nie eksperymentalna walidacja dla rzeczywistego mieszkania. Nie potwierdza dokładności bezwzględnych prognoz ani stabilności rankingu w każdym układzie.

## Funkcje wprowadzone w 2.8

- **Widoczne kratki wentylacyjne**: na planie wyświetlane są odrębne symbole nawiewu (niebieski) i wywiewu (fioletowy). Każda kratka ma własne pomieszczenie, pozycję X/Y (w metrach od lewego górnego rogu) oraz zadaną wydajność [m³/h]. Można dodać kilka kratek w jednym pomieszczeniu, zmienić ich typ lub usunąć.
- **Przesuwanie myszą**: narzędzie „Przesuń element” umożliwia przesuwanie drzwi i stałych otworów po wspólnej ścianie, okien po ich ścianach zewnętrznych oraz kratek wewnątrz pokojów. Pozycje są zapisywane z dokładnością 1 cm; ruch kratek jest ograniczony do granic ich pokoju.
- **Spójne obliczenia**: każda kratka stanowi osobny, zadany strumień dla solvera ciśnień i osobny punkt nawiewu/wywiewu w modelu transportu. Przestawienie drzwi, okna lub kratki przelicza przepływ, zachowując czas i lokalne stężenia.
- **Osobne źródła PM₂.₅**: etykieta `PM +... µg/h` przy pokoju oznacza emisję zanieczyszczeń, a nie nawiew/wywiew. Domyślna kuchnia ma emisję 1350 µg/h i **przykładową** kratkę wywiewną 30 m³/h. Te liczby nie są pomiarem domowej kuchni.
- **Kompatybilność**: zapis JSON v7 przechowuje kratki, okna i nieszczelności drzwi. Starsze plany z polami `supplyM3h`/`exhaustM3h` są przenoszone do widocznych kratek (bez podwójnego liczenia przepływu).
- **Testy regresyjne**: dodatkowe przypadki dotyczą dodawania i usuwania kratek, przeciągania elementów, migracji JSON i zachowania wyników symulacji; łącznie 29 testów.

## Zmiany w 2.7

- **Przepływ wywołany ciśnieniem**: wiatr ma prędkość m/s i kierunek (0° na prawo; 90° w dół), a elewacje mają różne ciśnienia umowne `Cp` (+0,6 od nawietrznej, do −0,3 od zawietrznej). Zamknięte okna: prawo potęgowe dla przecieków, otwarte: równanie otworu z miękkim ograniczeniem maksymalnej wymiany.
- **Bilans pomiędzy pokojami**: otwarte przejścia przepuszczają strumień pomiędzy pomieszczeniami; **zamknięte drzwi nie są szczelne** i umożliwiają mniejszy przepływ przez szczeliny. Rozwiązywane są ciśnienia referencyjne wszystkich pokojów, tak aby suma strumieni na danym węźle była bliska zeru.
- **Wietrzenie na przestrzał**: dwa okna na różnych ścianach mogą tworzyć przeciąg; pojedyncze okno również może stanowić dopływ przy działającym wyciągu. W całkowicie szczelnym pokoju z niekompensowanym wyciągiem solver pokazuje błąd bilansu i nie generuje fikcyjnego strumienia.
- **Wentylacja mechaniczna lub zadany strumień**: każda kratka ma własną wydajność w m³/h oraz pozycję X/Y mierzoną od lewego górnego rogu pokoju (interfejs od wersji 2.8). Nie modelujemy kanałów ani kształtu kratek, a sam stały strumień nie odwzorowuje samoczynnej zmienności wentylacji grawitacyjnej. Parametr ACH oznacza w modelu **referencyjną przepuszczalność nieszczelności obudowy przy 4 Pa**, a nie rzeczywistą gwarantowaną wymianę powietrza. Przepływ zależy od uzyskanej różnicy ciśnień. Nie naliczamy już dodatkowej, arbitralnej relaksacji 0,20 × ACH w równaniu PM₂.₅.
- **Podmuchy**: w scenariuszu okresowo zmienia się prędkość wiatru o ustawiony procent. Solver przelicza pole przepływu co 120 sekund czasu symulowanego, a zmienność ma charakter deterministyczny. Nie jest to losowy, zmierzony przebieg wiatru.
- **Mniejsze komórki PM₂.₅**: 0,30 / 0,20 / 0,15 m. Przy rozległym planie siatka adaptuje maksymalną liczbę komórek dla wydajności. Mniejszy krok zwiększa rozdzielczość, ale nie gwarantuje dokładniejszej prognozy.
- **Rozkład lokalny**: surowe wartości PM₂.₅ w komórkach bez graficznego rozmywania, odczyt pod kursorem i P90 w każdym pomieszczeniu. Wyświetlane stężenia nadal są uśrednione po wysokości pokoju.
- **Wskaźnik błędu bilansu** (m³/h) ostrzega o niekompatybilnej wentylacji; metryka przepływu pokazuje **sumę dopływów brutto** (równą odpływom w stanie zbilansowanym), a nie przepływ netto.
- **Zapis w JSON** zachowuje parametry ciśnień, wentylacji i rozdzielczości; import ze starszych wersji uzupełnia nowe dane wartościami domyślnymi.

## Jak oceniać ustawienie oczyszczacza?

1. Odwzoruj układ pokoi, a szczególnie okna, drzwi i rzeczywiste otwory.
2. Ustaw znane z pomiaru PM₂.₅ na zewnątrz; początkowe 24 µg/m³ to tylko przykład.
3. Podaj wymiary pomieszczeń, CADR dla drobnych cząstek oraz rzeczywistą wydajność nawiewu/wywiewu, jeśli jest znana.
4. Porównaj warianty przy zamkniętych i otwartych oknach, różnych kierunkach wiatru, wyłączonej wentylacji mechanicznej i jej pracy.
5. Sprawdź średnią, P90, lokalne stężenia i **30-minutowy ranking**. Ranking używa statycznego pola przepływu wybranego scenariusza i nie odtwarza osobno porywów; ma ograniczoną wartość przy wielogodzinnym lub bardzo niestabilnym wietrze.
6. Nie interpretuj drobnej różnicy między lokalizacjami jako przewagi: przetestuj stabilność rankingu przy siatce 0,30 i 0,15 m oraz w kilku scenariuszach.
7. Gdy masz czujnik PM₂.₅, zweryfikuj model w praktyce: przestaw urządzenie i obserwuj spadek PM przez 1–2 godziny przy porównywalnej pogodzie.

## Fizyczne przybliżenia i niepewności

- Węzeł ciśnienia na pokój zakłada wspólne średnie ciśnienie, a w 2D pole z projekcji rozdziela przepływ. Na krawędziach drzwi narzucane są teraz przepływy z sieci ciśnień (m³/h), a pole 2D jest korygowane osobno wewnątrz każdego pomieszczenia. To zapewnia zgodność **strumienia całkowitego na każdym przejściu**, lecz nie dokładny profil turbulentny strugi przez drzwi i pod skrzydłem.
- Współczynniki ciśnienia na fasadzie są idealizacją; osłonięcie przez inne budynki, wysokość okna, wiry od balkonów czy kształt budynku nie są znane.
- Otwarte okna wytwarzają uproszczony przepływ kierunkowy i dodatkową wymianę lokalną, ale **nie modelujemy realistycznego kształtu turbulentnego strumienia** ani wymiany wywołanej wyporem cieplnym (efekt kominowy), ani siły termicznej od grzejników/klimatyzacji.
- Wydmuch oczyszczacza ma przybliżoną siłę i kierunek, niezależnie od deklarowanego CADR. Nie znamy charakterystyki wentylatora ani geometrii wlotu/wylotu.
- Nie modelujemy mebli, człowieka ani pionowych strug, a stężenia PM₂.₅ są uśrednione po wysokości (lokalnie w planie, nie w całym pokoju).
- Nie stosuje się już globalnego sztucznego ograniczenia prędkości do 1,25 m/s. Krok transportu PM₂.₅ zmniejsza się przy większej prędkości. Przy bardzo dużych przepływach siatka 2D nadal może wymagać dodatkowego zagęszczenia i kontroli dokładności.
- Brak modelu temperatury, wilgoci, CO₂, alergenów i strat filtra; to **symulacja wyłącznie PM₂.₅**.

## Model matematyczny — odniesienia

- NIST [CONTAM](https://www.nist.gov/services-resources/software/contam), [User Guide](https://www.nist.gov/publications/contam-user-guide-and-program-documentation-version-34) — wielostrefowe ciśnienia i transport zanieczyszczeń, prawo potęgowe dla nieszczelności, równanie przepływu przez otwory.
- [ASHRAE Handbook, Indoor Environmental Modeling](https://handbook.ashrae.org/handbooks/F25/SI/F25_Ch13/F25_Ch13_si.aspx) — model sieci przepływowej między strefami.
- [EPA — Guide to Air Cleaners in the Home](https://www.epa.gov/indoor-air-quality-iaq/guide-air-cleaners-home) — odpowiedni CADR, miejsce ustawienia, brak przeszkód przy wentylatorze.

## Testy i organizacja

```bash
node --check app.js
node --check airflow-network.js
python -m pip install playwright==1.57.0
python -m playwright install chromium
python -m unittest discover -s tests -v
```

Automatyczne testy Playwright w `tests/test_regressions.py` oraz `tests/test_editor_interactions.py` uruchamiają testy geometrii, pól stężeń, bilansu sieci, wiatru, przeciągów, nawiewu i wywiewu. Workflow GitHub Actions uruchamia te testy na branchach i PR.

- `index.html`, `styles.css` — UI.
- `airflow-network.js` — oddzielony, testowalny solver ciśnień węzłowych.
- `app.js` — edytor, siatka, transport PM, rendering i obsługa JSON.
- `tests/test_regressions.py` i `tests/test_editor_interactions.py` — testy przeglądarkowe.

**Kolejne kroki dla dokładności:** walidacja na pomiarach w rzeczywistym mieszkaniu; geometria mebli i przeszkód; przepływ przez wywiew grawitacyjny i efekt kominowy; niezależna weryfikacja 3D na kilku przykładach; wielowariantowa optymalizacja ustawienia oczyszczacza (nie pojedynczy scenariusz pogody).

## Eksperymentalny rework interfejsu — UI Lab

Ta gałąź zawiera **eksperymentalny interfejs AeroPlan 2.12**, nieprzeznaczony do automatycznego scalania z `main`. Główne mechanizmy obliczeniowe nie zostały zmienione.

- U góry: zawsze dostępny zapis i wczytanie nazwanych projektów.
- Z lewej: cztery zakładki „Plan”, „Powietrze”, „Oczyszczacz”, „Projekty”.
- Na środku: mapa, sterowanie symulacją, ranking i najważniejsze metryki.
- W menu rozwijanym: rzadsze narzędzia edycji, zaawansowane wyniki i pełne ostrzeżenia modelu.
- Na telefonie: kompaktowy panel z przyciskiem „Przejdź do mapy”.

Do uruchomienia wymagany jest dodatkowy plik `ui-shell.js` w tym samym katalogu co `index.html`. Szczegóły i kryteria akceptacji znajdują się w [`UI-EXPERIMENT.md`](UI-EXPERIMENT.md).
