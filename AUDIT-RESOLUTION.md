# AeroPlan 2.11 — zamknięcie audytu kodu

Punkt odniesienia: niezależny audyt wersji 2.8 (commit `2e472bb`) oraz wcześniejsze poprawki 2.9/2.10. Ta runda obejmuje **stabilizację aplikacji**, bez dodawania nowych funkcji produktowych.

## Znalezione problemy kodu C1–C12

| Punkt | Wynik | Uzasadnienie / test |
|---|---|---|
| C1 | Naprawiony od 2.10 | Przesunięcie oczyszczacza i wybranie ustawienia z rankingu nie zerują czasu ani stężeń; testy przestawiania |
| C2 | Naprawiony od 2.10 | Ponowna konfiguracja sprawdza też krok siatki, nie tylko liczbę komórek |
| C3 | Naprawiony od 2.10 | Metryka przepływu opisana jako **dopływ brutto**, nie netto |
| C4 | Naprawiony od 2.10 | Usunięty martwy `best=sort[0]` |
| C5 | Naprawiony od 2.10 | Masa korygowanych ujemnych stężeń widoczna na ekranie |
| C6 | Naprawiony od 2.10 | Poprawna numeracja sekcji |
| C7 | Naprawiony od 2.10 | Wartości domyślne formularza i modelu zgodne |
| C8 | Naprawiony od 2.10 | Wspólna stała `MAX_SPAN` |
| C9 | **Dokończony w 2.11** | Import sprawdza zakresy liczb i referencje, nie gubi nieprawidłowych drzwi/okien, wykrywa kolizje przejść, odrzuca niemożliwy rozmiar oczyszczacza; transakcja przywraca sesję po błędzie; regresje importu starszych JSON |
| C10 | Naprawiony od 2.10 | Gęstość powietrza 1,204 kg/m³ |
| C11 | **Poprawiony w 2.11** | Wygładzanie prawa przepływu przy Δp≈0 z asymptotycznie prawidłową zależnością dla zwykłych ciśnień; pochodna Newtona zgodna z wygładzonym równaniem; test porównania z prawem analitycznym |
| C12 | **Dokończony w 2.11** | Jeden nasłuch `pointermove`, funkcje edytora, podświetlenia i pomiaru lokalnego osobno |

## Model i wyniki L1–L7

| Punkt | Status | Komentarz |
|---|---|---|
| L1–L2 | Naprawione od 2.10 | Jedno źródło wymiany przez nieszczelności ciśnieniowe, poprawiona penetracja PM₂.₅ |
| L3 | Zasadniczo poprawiony od 2.10 | Strumień całkowity przez każde przejście w 2D jest zadany przez sieć ciśnień; **profil strugi nadal przybliżony** |
| L4 | Naprawiony od 2.10 | Usunięte globalne obcięcie prędkości |
| L5 | **Ulepszony w 2.11** | Każdy podkrok integruje dawkę PM₂.₅ metodą trapezów zamiast próbkowania co 15 kroków; stan przepływu taki sam dla kandydatów; test rankingu i niezależna kontrola przy połowie kroku |
| L6 | **Jawne założenie modelu**, nie błąd JS | Współczynniki fasady `Cp` pozostają orientacyjne i niekalibrowane |
| L7 | **Ograniczenie metody**, nie błąd JS | Brak CFD 3D, mebli, rozkładu pionowego, temperatury i efektu kominowego; wymaga odrębnej rozbudowy i oceny fizycznej |

## Dodatkowe błędy wykryte podczas rundy 2.11

- Nierozwiązany bilans ciśnień potrafił pozostawić przycisk porównania nieaktywny; warunki walidacji znajdują się teraz w `try/finally`.
- Wybór pozycji z rankingu zerował symulację, mimo naprawy bezpośredniego przeciągania oczyszczacza.
- Automatyczne dodanie drzwi mogło utworzyć nachodzące przejścia. Teraz sprawdza wolne miejsca i ewentualnie mniejsze szerokości; bez wolnego miejsca proponuje ręczny wybór.
- Zmiana pokojów przypisanych do istniejących drzwi mogła spowodować niepoprawne połączenie; taka edycja jest odrzucana.
- Edycja wymiarów lub przesuwanie pokoju nie mogą już potajemnie odłączyć istniejących przejść lub umieścić okien na ścianie wewnętrznej.
- Usunięcie drzwi w panelu nie zeruje już stanu symulacji.

## Jak odczytywać wynik audytu

**Zamknięte są pozycje audytu dotyczące kodu i potwierdzonych regresji.** Nie oznacza to, że wyniki AeroPlan są empirycznie potwierdzonym pomiarem jakości powietrza lub dokładną prognozą CFD. Wynik rankingu ma sens tylko w ramach scenariuszowego modelu 2D i należy porównywać kilka rozsądnych warunków.

Nie są potrzebne własne pomiary do pierwszego uruchomienia czy wstępnego wyboru urządzenia, ale nieznane parametry takie jak `Cp`, rzeczywiste strumienie wentylacji, charakterystyka nawiewu i penetracja pyłu znacząco wpływają na **pewność** rekomendacji. Drobne różnice w rankingu należy traktować jak remis.

## Testowanie

```bash
node --check app.js
node --check airflow-network.js
python -m pip install playwright==1.57.0
python -m playwright install chromium
python -m unittest discover -s tests -v
```

Regresje importu, obsługi myszy, drzwi, porównania i prawa przepływu w `tests/test_audit_cleanup.py` uzupełniają dotychczasowe testy fizyki i edytora. W CI uruchamiają się wraz z pozostałymi testami.
