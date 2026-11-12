# AeroPlan — UI Lab (eksperymentalny rework interfejsu)

**Status: prototyp na osobnym branchu. Nie scalać automatycznie do `main`.** Bazą funkcjonalną jest AeroPlan 2.12. Zmiany dotyczą prezentacji, nawigacji i organizacji formularzy; kod silnika `app.js` i `airflow-network.js` oraz format zapisu JSON v7 pozostały bez zmian.

## Powód eksperymentu

Dotychczasowy interfejs wyświetlał wszystkie sekcje konfiguracji na jednej długiej liście. Zapis projektu znajdował się na samym końcu panelu, przez co użytkownik musiał go szukać, mimo że jest to czynność podstawowa i częsta.

## Najważniejsze decyzje projektowe

1. **Projekty zawsze pod ręką** — na górnym pasku są nazwa bieżącego projektu, przycisk „Zapisz projekt”, lista zapisanych projektów i „Wczytaj”. Funkcje używają tych samych istniejących identyfikatorów i mechanizmu `localStorage` co w 2.12.
2. **Cztery sekcje konfiguracji** — „Plan” (pokoje, drzwi, okna), „Powietrze” (wentylacja i wiatr), „Oczyszczacz” (CADR i wydmuch) oraz „Projekty” (eksport/import JSON, usuwanie zapisów). Tylko jedna sekcja jest widoczna jednocześnie.
3. **Mapa jest głównym obszarem pracy** — ustawienia w bocznym panelu, mapa i sterowanie symulacją stale dostępne obok. Pełna lista danych diagnostycznych i długie ostrzeżenie o ograniczeniach modelu są rozwijane na żądanie, nie usunięte.
4. **Mniej przycisków naraz** — podstawowe narzędzia edytora są widoczne, rzadziej używane tworzenie/usuwanie elementów znajduje się w rozwijanym menu.
5. **Dostępność i urządzenia mobilne** — semantyczne zakładki z obsługą klawiatury (strzałki, Home, End), widoczne stany aktywne, focus outline, panel o ograniczonej wysokości i przycisk „Przejdź do mapy” na wąskich ekranach.
6. **Zapis na dysku pozostaje** — eksport i import JSON są dostępne w sekcji „Projekty”, również gdy przeglądarka nie pozwala korzystać z pamięci lokalnej.

## Czego ten branch celowo nie zmienia

- Równań przepływu i transportu PM₂.₅, solvera ciśnień, modelu oczyszczacza i algorytmu rankingu.
- Znaczenia pól formularza i walidacji geometrii.
- Schematów JSON oraz istniejących zapisów `localStorage`.
- Wyników numerycznych przy tych samych parametrach wejściowych.

## Testy

```bash
node --check app.js
node --check airflow-network.js
node --check ui-shell.js
AEROPLAN_CHROMIUM=/usr/bin/chromium python -m unittest discover -s tests -v
```

Przebudowany interfejs sprawdzono w Chromium, w tym w szerokości 1440 px i 390 px. Testy obejmują widoczność zapisu, nawigację myszą i klawiaturą, sprawdzanie zachowania czasu i stężeń przy przełączaniu sekcji, przejście do mapy na telefonie oraz zachowanie oryginalnych identyfikatorów DOM. Testy regresyjne fizyki i zapisu również uruchamiane są bez dodatkowych bibliotek aplikacyjnych.

**Uwaga o testach:** przy testowaniu lokalnego pliku w środowisku automatycznym przeglądarka może blokować `localStorage` dla stron bez zwykłego origin. Testy zapisu używają zgodnego z Web Storage mechanizmu, by zweryfikować logikę aplikacji; nie gwarantują, że plik `file://` zachowa zapis po zmianie nazwy lub przeniesieniu.

## Kryteria decyzji o ewentualnym scaleniu

- Podstawowe działanie aplikacji jest niezmienione i istniejące testy przechodzą.
- Użytkownik potwierdza, że panel ma sens na jego ekranie i że zapis/wczytanie jest dostatecznie intuicyjne.
- Opcjonalnie przed scaleniem dopracować słownictwo, skrócić opisy narzędzi i rozważyć własny panel podsumowania projektu zamiast rozbudowanej belki na bardzo małych ekranach.
