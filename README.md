# AeroPlan

**AeroPlan 2.5** to lokalna aplikacja przeglądarkowa do szkicowania układu mieszkania oraz **porównywania ustawień oczyszczacza powietrza** na podstawie uproszczonego modelu 2D transportu PM₂.₅.

> **To nie jest pełne CFD ani pomiar jakości powietrza.** Wyniki mają charakter orientacyjny i służą do zestawiania scenariuszy, nie do certyfikowania skuteczności urządzenia ani wyznaczania rzeczywistego rozkładu stężeń.

## Uruchomienie

1. Sklonuj repozytorium lub pobierz pliki `index.html`, `styles.css` i `app.js` do **jednego folderu**.
2. Otwórz `index.html` w aktualnej wersji przeglądarki (Chrome, Edge lub Firefox).
3. Opcjonalnie uruchom prosty lokalny serwer: `python -m http.server 8000` i przejdź na `http://localhost:8000`.

Nie trzeba instalować zależności JavaScript, kompilować projektu ani łączyć się z serwerem. Aplikacja działa po stronie użytkownika.

## Funkcje

- Rysowanie, przesuwanie, zaznaczanie i usuwanie prostokątnych pokojów; dokładne wymiary w metrach.
- Otwierane i zamykane drzwi, stale otwarte przejścia oraz okna umieszczane na ścianach zewnętrznych.
- Regulowana szczelność okien i stany: zamknięte, rozszczelnione, otwarte.
- Ręczne ustawienie **PM₂.₅ za oknem** (przykładowa wartość początkowa nie jest rzeczywistym pomiarem).
- Parametry CADR oczyszczacza, średnica, kierunek i siła wydmuchu; ograniczenie pozycji do obrysu pomieszczenia.
- Mapa stężeń, podgląd kierunków przepływu i średnie PM₂.₅ dla każdego pokoju.
- Symulacja **bez domyślnego limitu czasu**, z możliwością ustawienia limitu.
- Automatyczne porównywanie lokalizacji oczyszczacza na ograniczonym horyzoncie obliczeń.
- Import i eksport projektu w JSON oraz zapis obrazu planu w PNG.

## Pierwsze kroki

1. Kliknij **Pusty plan** albo skorzystaj z przykładu mieszkania.
2. Narysuj pokoje myszką; przesuń je i skoryguj wymiary w panelu.
3. Dodaj drzwi, stałe otwory oraz okna.
4. Ustaw parametry wentylacji, emisji i **rzeczywiste PM₂.₅ na zewnątrz**.
5. Ustaw oczyszczacz, wybierz **Start**, porównuj wyniki w pomieszczeniach.
6. Zapisz projekt jako JSON, aby wrócić do niego później.

## Założenia i ograniczenia

- Obliczenia są dwuwymiarowe, uśrednione po wysokości pomieszczeń.
- Przepływ przez okna i pozostałą wentylację jest przybliżony; nie ma pełnego modelu różnic ciśnień ani lokalnych strug wiatru.
- Model nie odtwarza wiernie turbulencji 3D, mebli, konwekcji termicznej, wymuszeń od grzejników i klimatyzacji czy rzeczywistych charakterystyk wentylatorów.
- Klasy szczelności okien i parametry przepuszczalności są założeniami modelu, a nie zmierzonymi parametrami konkretnego okna.
- Rzeczywista skuteczność oczyszczania zależy również od położenia urządzenia, przeszkód, wentylacji i eksploatacji filtrów.
- Stężenie na zewnątrz **nie jest pobierane automatycznie**; wpisz odczyt z czujnika lub monitoringu.
- Nie traktuj symulacji jako podstawy decyzji wymagających dokładnych badań środowiskowych.

## Pliki

| Plik | Zawartość |
|---|---|
| `index.html` | Interfejs aplikacji |
| `styles.css` | Styl i układ graficzny |
| `app.js` | Edytor planu, model symulacji, obliczenia, wizualizacja i zapis |
| `README.md` | Instrukcja i ograniczenia |

## Wersja

**2.5** — domyślnie nieograniczony czas symulacji; pozostałe funkcje obejmują poprawki edytora do wersji 2.4, ustawienia okien i przejść oraz mapę średnich stężeń. Wersje historyczne były dostarczane jako oddzielne paczki; w repozytorium znajduje się **aktualny kod źródłowy**.

## Uwaga dotycząca licencji

W repozytorium nie określono jeszcze licencji na wykorzystanie i redystrybucję kodu.
