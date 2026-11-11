# AeroPlan 2.7 — symulacja PM₂.₅ i przepływu w mieszkaniu

AeroPlan to lokalna aplikacja HTML/CSS/JS do rysowania planu mieszkania, porównania różnych lokalizacji oczyszczacza powietrza i sprawdzenia wpływu wentylacji. Od wersji 2.7 korzysta z **dwóch powiązanych uproszczonych modeli**:

1. **Wielostrefowy model ciśnień i przepływów** (pokoje jako węzły, okna i drzwi jako opory, nawiew/wywiew, ciśnienie wiatru na elewacji, bilans masowy). Kod w `airflow-network.js`.
2. **Lokalny dwuwymiarowy model transportu zanieczyszczeń**: pole prędkości na siatce, adwekcja–dyfuzja i bilans PM₂.₅, dopływ z zewnątrz, źródła pyłu, osadzanie i filtracja CADR. Kod w `app.js`.

> **Nie jest to walidowane CFD 3D, rzeczywisty pomiar ani program projektowania instalacji wentylacyjnych.** Podane wartości ciśnień, prędkości, lokalnych stężeń i rankingi są orientacyjne. Bez danych o budynku, wietrze, meblach i urządzeniach nie ma podstaw do deklarowania dokładności absolutnej.

## Uruchomienie

1. Pobierz `index.html`, `styles.css`, `airflow-network.js`, `app.js` do jednego folderu.
2. Otwórz `index.html` w nowej przeglądarce. Nic nie trzeba instalować; aplikacja działa offline.
3. Do rozwoju można użyć `python -m http.server 8000`.

## Co nowego w 2.7

- **Przepływ wywołany ciśnieniem**: wiatr ma prędkość m/s i kierunek (0° na prawo; 90° w dół), a elewacje mają różne ciśnienia umowne `Cp` (+0,6 od nawietrznej, do −0,3 od zawietrznej). Zamknięte okna: prawo potęgowe dla przecieków, otwarte: równanie otworu z miękkim ograniczeniem maksymalnej wymiany.
- **Bilans pomiędzy pokojami**: otwarte przejścia mogą przepuszczać strumień pomiędzy pomieszczeniami; zamknięte drzwi go blokują. Rozwiązywane są ciśnienia referencyjne wszystkich pokojów, tak aby suma strumieni na danym węźle była bliska zeru.
- **Wietrzenie na przestrzał**: dwa okna na różnych ścianach mogą tworzyć przeciąg; pojedyncze okno również może stanowić dopływ przy działającym wyciągu. W całkowicie szczelnym pokoju z niekompensowanym wyciągiem solver pokazuje błąd bilansu i nie generuje fikcyjnego strumienia.
- **Wentylacja mechaniczna**: każdy pokój ma opcjonalną wydajność nawiewu/wywiewu w m³/h oraz pozycję X/Y kratki mierzoną od lewego górnego rogu pokoju. Nie modelujemy kanałów ani kształtu kratek. Stary parametr ACH pozostaje jako *umowna nieszczelność obudowy i mała rezerwowa wymiana dwukierunkowa*, nie jest modelem kratki wentylacyjnej.
- **Podmuchy**: w scenariuszu okresowo zmienia się prędkość wiatru o ustawiony procent. Solver przelicza pole przepływu co 120 sekund czasu symulowanego, a zmienność ma charakter deterministyczny. Nie jest to losowy, zmierzony przebieg wiatru.
- **Mniejsze komórki PM₂.₅**: 0,30 / 0,20 / 0,15 m. Przy rozległym planie siatka adaptuje maksymalną liczbę komórek dla wydajności. Mniejszy krok zwiększa rozdzielczość, ale nie gwarantuje dokładniejszej prognozy.
- **Rozkład lokalny**: surowe wartości PM₂.₅ w komórkach bez graficznego rozmywania, odczyt pod kursorem i P90 w każdym pomieszczeniu. Wyświetlane stężenia nadal są uśrednione po wysokości pokoju.
- **Wskaźnik błędu bilansu** (m³/h) ostrzega o niekompatybilnej wentylacji; metryka przepływu odpowiada symulowanemu dopływowi netto.
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

- Węzeł ciśnienia na pokój zakłada wspólne średnie ciśnienie, a w 2D pole z projekcji rozdziela przepływ. Przepływ na poszczególnych drzwiach z sieci ciśnień nie jest narzucony dokładnie jako warunek brzegowy solvera 2D; rozdział strumieni przez wiele przejść może więc odbiegać od wyliczeń sieci.
- Współczynniki ciśnienia na fasadzie są idealizacją; osłonięcie przez inne budynki, wysokość okna, wiry od balkonów czy kształt budynku nie są znane.
- Otwarte okna wytwarzają uproszczony przepływ kierunkowy i dodatkową wymianę lokalną, ale **nie modelujemy realistycznego kształtu turbulentnego strumienia** ani wymiany wywołanej wyporem cieplnym (efekt kominowy), ani siły termicznej od grzejników/klimatyzacji.
- Wydmuch oczyszczacza ma przybliżoną siłę i kierunek, niezależnie od deklarowanego CADR. Nie znamy charakterystyki wentylatora ani geometrii wlotu/wylotu.
- Nie modelujemy mebli, człowieka ani pionowych strug, a stężenia PM₂.₅ są uśrednione po wysokości, nie po pokoju.
- Aby zachować stabilność, prędkości pola 2D są ograniczane do 1,25 m/s. Jeśli ten limit zadziała, zmniejszona zostaje również wymiana używana w bilansie PM. Metryki uwzględniają ograniczenie, ale scenariusz należy traktować jako obarczony większym błędem.
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

Automatyczne testy Playwright w `tests/test_regressions.py` uruchamiają testy geometrii, pól stężeń, bilansu sieci, wiatru, przeciągów, nawiewu i wywiewu. Workflow GitHub Actions uruchamia te testy na branchach i PR.

- `index.html`, `styles.css` — UI.
- `airflow-network.js` — oddzielony, testowalny solver ciśnień węzłowych.
- `app.js` — edytor, siatka, transport PM, rendering i obsługa JSON.
- `tests/test_regressions.py` — testy przeglądarkowe.

**Kolejne kroki dla dokładności:** walidacja na pomiarach w rzeczywistym mieszkaniu; geometria mebli i przeszkód; przepływ przez wywiew grawitacyjny i efekt kominowy; niezależna weryfikacja 3D na kilku przykładach; wielowariantowa optymalizacja ustawienia oczyszczacza (nie pojedynczy scenariusz pogody).