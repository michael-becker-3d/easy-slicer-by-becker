# Prüfanleitung: Z-Korrektur und Prime-Linie am Anycubic Vyper

Diese Anleitung beschreibt einen kurzen Test an einem echten Vyper mit Marlin. Die App wurde bisher nur in der Simulation und mit G-Code-Prüfungen getestet, nicht auf Hardware.

## Vorbereitung

1. Vyper über USB verbinden und in **Drucker → Verbindung** den USB-Modus wählen. Erst wenn oben „Simulation“ bzw. der COM-Port und **verbunden** erscheinen, sind die Z-Schalter aktiv.
2. Bett reinigen, Filament laden und die Düse vorher grob über die Papiermethode nivellieren. Die Live-Korrektur ersetzt kein Nivellieren.
3. Ein kleines, flaches Testteil slicen (z. B. 40 × 40 mm, eine Schicht) oder den **G-Code-Prüfsatz** verwenden.
4. Unter **Haftung & Mesh** die **Düsenreinigung · Prime-Linie** einschalten: Länge `60 mm`, Tempo `20 mm/s` sind die Standardwerte.
5. Vor dem Start im G-Code nach `; ---- Prime-Linie` suchen. Dort müssen eine Fahrt an den Bettrand, eine Linie mit `F1200` (20 mm/s × 60) und danach die erste Schicht stehen. erscheint keine Prime-Linie, steht im Slice-Bericht der Grund (kein freier Randstreifen).

## Test 1: Prime-Linie

1. Druck starten und die ersten Sekunden am Gerät bleiben. **Hände weg von der beweglichen Platte und der heißen Düse.**
2. Die Düse muss vor dem Bauteil eine einzelne Linie auf dem Bett ziehen. Sie darf weder auf dem Modell noch auf einem Skirt/Brim liegen.
3. Die Linie soll etwa `60 mm` lang sein und sauber extrudieren. Danach beginnt der eigentliche Druck.
4. Wenn keine Linie erscheint: Druck abbrechen, Prime-Linie auf `40 mm` verkürzen oder das Modell etwas kleiner platzieren. Bei Brim/Skirt braucht die Automatik mehr Randabstand.
5. Wenn die Linie zu nah an der Düse klebt oder das Bett schrammt: sofort abbrechen und zuerst die Z-Höhe korrigieren.

**Erwartet:** Eine freie, extrudierte Linie am Rand, bevor das Modell gedruckt wird. Bei `enabled: false` darf keine Prime-Linie im G-Code stehen.

## Test 2: Z-Korrektur während des Drucks

1. Den Druck starten und die erste Schicht beobachten.
2. Im **Drucker**-Tab unter **Z-Korrektur** zuerst mit den groben Schaltern arbeiten: `−1,00`, `−0,50`, `−0,25`, `+0,25`, `+0,50`, `+1,00 mm`.
3. Ist die Linie zu platt oder schrammt die Düse: mit `+0,25` anheben. Bleibt eine Lücke zwischen den Linien: mit `−0,25` absenken.
4. Nach jeder Änderung eine kurze Bahn abwarten. Für den Feinschliff `±0,05` und `±0,01 mm` verwenden, nicht mehrere Schritte gleichzeitig.
5. Die Anzeige **Babystep** muss den Wert mitführen, z. B. `+0.250 mm`. **Reset** setzt den Live-Offset auf `0.000 mm` zurück, ohne ihn dauerhaft zu speichern.
6. **Nicht** während des Drucks „Setzen + speichern“ verwenden. Das schreibt bei Marlin `M206` und `M500` dauerhaft ins EEPROM und ist für den laufenden Offset nicht gedacht.

**Erwartet:** Jeder Klick verändert die Düsenhöhe sofort über `M290`; die Anzeige springt nicht doppelt und Reset zeigt wieder `+0.000 mm`.

## Dauerhaften Wert übernehmen

Erst nach einem sauberen Testdruck:

1. Druck beenden, Düse und Bett abkühlen lassen bzw. sicher parken.
2. Gewünschten Z-Offset im Feld eintragen und **Setzen + speichern** drücken. Bei Marlin wird `M206 Z…` gefolgt von `M500` gesendet.
3. Danach einen neuen ersten Layer drucken und prüfen, ob der Wert auch nach einem Neustart erhalten bleibt.

## Abbruchkriterien

- Düse berührt das Bett oder das Bauteil sichtbar.
- Kein Filament kommt aus der Düse.
- Die Prime-Linie wird auf dem Modell gedruckt.
- Die Z-Anzeige reagiert nicht auf einen Schritt oder die Firmware meldet einen Fehler.

In diesen Fällen sofort **Beenden/Abbrechen** und die Ursache prüfen. Die Simulation bestätigt nur die Softwarelogik, nicht die Mechanik oder Firmware des konkreten Druckers.
