# AeroPlan 2.6

AeroPlan to interaktywna aplikacja w HTML, CSS i JavaScript do szkicowania mieszkania oraz **orientacyjnego** porównywania ustawień oczyszczacza powietrza. Oblicza i wizualizuje transport PM₂.₅ w uproszczonym modelu 2D.

> **Nie jest to pełny symulator CFD 3D, pomiar jakości powietrza ani narzędzie do wyznaczania narażenia zdrowotnego.** Wyniki porównują scenariusze i wymagają weryfikacji pomiarami.

## Uruchomienie

Pobierz `index.html`, `styles.css` i `app.js` do jednego katalogu i otwórz `index.html` w aktualnej przeglądarce. Instalacja bibliotek ani dostęp do sieci nie są wymagane. Alternatywnie uruchom `python -m http.server 8000` w katalogu projektu i przejdź do `http://localhost:8000`.

## Co można zrobić?

- Narysować, przesuwać i wymiarować pokoje (min. 0,5 × 0,5 m), w tym pokoje o niestandardowych wymiarach.
- Dodawać drzwi, stale otwarte przejścia i okna; zmieniać stan drzwi i okien podczas symulacji.
- Ustawiać infiltrację przez zamknięte okna, rozszczelnienie i otwarcie, różnicę ciśnień, wymianę przez pozostałą wentylację oraz rzeczywiste stężenie PM₂.₅ na zewnątrz.
- Włączyć scenariusz **wiatru** i wybrać jego kierunek na planie: 0° z lewej na prawą, 90° z góry na dół. Model równoważy nawiew i wywiew przez okna w obrębie połączonych pokojów. Pojedyncze okno bez ujścia powietrza pozostaje przybliżoną wymianą lokalną. Wartość kierunku jest **założeniem użytkownika**, nie pomiarem.
- Regulować CADR, kierunek wydmuchu, rozmiar i położenie oczyszczacza.
- Odczytywać średnie PM₂.₅ w pokojach, sumę usuniętego pyłu oraz orientacyjne natężenie wymiany okiennej.
- Uruchomić symulację bez limitu czasu albo włączyć opcjonalne ograniczenie czasu.
- Porównać ustawienia oczyszczacza: pozycję środkową w każdym pokoju oraz aktualną pozycję użytkownika (nie jest to pełna optymalizacja ciągła).
- Eksportować/importować plan w JSON oraz zapisywać obraz PNG.

## Naprawy w wersji 2.6

- **Kolizje pokoi** są wykrywane w dokładnej geometrii prostokątów, nie tylko w komórkach siatki. Edycje prowadzące do kolizji są odrzucane z przywróceniem wcześniejszych wartości. Nieprawidłowy import JSON nie zastępuje prawidłowego planu.
- **Okna** nie mogą nachodzić na siebie. Edycja wymiarów i położenia jest walidowana. Okno zachowuje zadaną szerokość przy krańcu ściany poprzez przesunięcie środka, a nie ucięcie połowy okna.
- **Wąskie drzwi i przejścia** są modelowane za pomocą ułamkowej przepuszczalności krawędzi siatki, zamiast jedynie próbkowania pojedynczych punktów.
- **Zmiana drzwi w panelu** przebudowuje połączenia, zachowując czas i bieżące stężenia; tak jak kliknięcie drzwi na planie.
- **Małe pomieszczenia** mają objętości komórek przeskalowane do dokładnej kubatury pokoju. Transport między komórkami używa tych objętości, aby zachowywać bilans masy. Pozostaje błąd geometryczny przybliżenia kształtu komórek i lokalnego pola prędkości przy granicach ścian.
- **Okna a przepływ**: dla dwóch lub więcej otworów nawiewnych/wywiewnych w tej samej połączonej strefie można włączyć szacowany przepływ wywołany kierunkiem wiatru. Pole prędkości i transport PM₂.₅ korzystają ze wspólnie bilansowanych strumieni. Pozostała wymiana powietrza jest reprezentowana jako wymiana lokalna.
- Dodano automatyczne testy regresyjne i GitHub Actions.

## Ograniczenia modelu

- To pole 2D uśrednione po wysokości, bez obliczania turbulencji 3D, wpływu mebli, temperatury, konwekcji czy rzeczywistej charakterystyki wentylatora.
- Różnica ciśnień i kierunek wiatru są parametrami scenariusza. **Nie rozwiązujemy rzeczywistego układu ciśnień budynku ani pełnych warunków brzegowych.** Model nie symuluje przeciągu wynikającego z pojedynczego otwartego okna, gdy brak ujścia w tej samej strefie.
- Parametr ACH dla pozostałej wentylacji jest przybliżoną wymianą stężenia, a nie dokładnym obliczeniem strumienia na rzeczywistych kratkach i nawiewnikach.
- Komórki siatki mają zastępcze objętości zachowujące objętości pokojów; nie jest to adaptacyjny solwer na pełnych komórkach częściowych. Wąskie wnęki i elementy mniejsze od siatki nadal mogą być nieprawidłowo odwzorowane.
- Wartość PM₂.₅ na zewnątrz wprowadzana jest ręcznie. Domyślna wartość jest przykładowa, nie jest bieżącym odczytem z czujnika.
- Rankingi i lokalne stężenia **nie powinny być interpretowane jako wyniki zweryfikowanej symulacji CFD** ani jako pomiar rzeczywistej skuteczności oczyszczacza.

## Testy dla programistów

Wymagany Python 3.12+ z Playwright i Chromium. Samo uruchomienie aplikacji nie wymaga Pythona ani zależności.

```bash
node --check app.js
python -m pip install playwright==1.57.0
python -m playwright install chromium
python -m unittest discover -s tests -v
```

W CI GitHub Actions instalowana jest przeglądarka i uruchamiane są scenariusze regresji. W lokalnym systemie Linux z Chromium w systemie można wskazać `AEROPLAN_CHROMIUM=/usr/bin/chromium`.

## Organizacja plików

- `index.html` — interfejs
- `styles.css` — style
- `app.js` — edytor, model i renderowanie
- `tests/test_regressions.py` — testy integracyjne i numeryczne
- `.github/workflows/ci.yml` — automatyczna kontrola składni i testy

Kod modelu znajduje się nadal w jednym pliku `app.js`; docelowy podział na moduły geometrii, solvera, UI i obsługi plików jest osobnym, większym zadaniem refaktoryzacyjnym.