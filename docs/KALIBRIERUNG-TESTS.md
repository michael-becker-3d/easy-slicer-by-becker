# Kalibrier-Tests — Modelle, Voreinstellungen und Quellen

Stand: 22.11.2026. Die Kalibrier-Tests verwenden die sieben eigenen STL-Modelle aus
`slicer_calibration_models`. Sie liegen im Projekt unter `assets/calibration-models`
und werden in der EXE als Assets mitgeführt — der Assistent liest sie direkt, es wird
nichts nachgeladen und nichts hochgeladen.

## Was der Assistent kann

| Test | Modell | Feste Stufen | Einstellbar |
| --- | --- | --- | --- |
| Temperatur | Thermal-Cell (28 × 21 × 48 mm) | 6 Kammern à 8 mm | Von/Bis/Schritt in °C |
| Max. Volumenstrom | Max-Flow-Core (40 × 40 × 35 mm) | 7 Bänder à 5 mm | Von/Bis/Schritt in mm³/s |
| Pressure Advance | PA-Blade (46 × 46 × 40 mm) | 10 Stufen à 4 mm | Von/Bis/Schritt, Direct Drive/Bowden |
| Retract | Needle-Grid (52 × 45 × 37 mm) | 5 Stufen à 7 mm ab z 2 mm | Von/Bis/Schritt, Direct Drive/Bowden |
| Resonanz / Input Shaper | Resonance-Fin (90 × 18 × 45 mm) | 5 Stufen à 9 mm | Von/Bis/Schritt in Hz |
| Überhänge | Overhang-Array (49 × 55 × 20 mm) | — | nichts (Formtest, wird ohne Stützen gedruckt) |
| Passung | Mech-Clutch (68 × 22 × 11 mm) | — | nichts (Formtest) |

Die Stufenzahl steckt in der Geometrie: Die Thermal-Cell hat sechs Kammern, der
Max-Flow-Core sieben Bänder, die PA-Blade zehn Stufen. Einstellbar sind nur die Werte —
Von, Bis und Schrittweite. Ergibt die Eingabe nicht genau die Stufenzahl, lehnt der
Assistent mit einer klaren Meldung ab, statt den Bereich still zu kürzen. Alle Modelle
laufen mit 0,20 mm Schichthöhe; die Werte wechseln an der ersten vollständigen Schicht
der nächsten Stufe.

Zusätzlich bleiben vier eingebaute Tests erhalten, für die es kein eigenes Modell gibt:
der **Flusswürfel** (30 mm, eine Außenwand), der **Erste-Schicht-Test**, der
**PA-Linientest** (220 × 24 mm Platte) und der **VFA-/Geschwindigkeitsturm**.

Die früheren generierten Türme für Temperatur, Retract, Max-Flow und Pressure Advance
sowie der Passungskupon sind durch die neuen Modelle ersetzt. Die TempTest.stl aus dem
Download-Ordner wird nicht mehr benötigt.

## Vergleich mit den großen Slicern

Recherchestand: OrcaSlicer 2.5.0, PrusaSlicer 3.0-alpha und Bambu Studio (Flow-Dynamics-/Kalibrier-Assistent). Die Bereiche sind bewusst als Startwerte gedacht, nicht als harte Grenzen.

| Slicer | Drucker-/Extruderbezug | Relevante Voreinstellungen |
| --- | --- | --- |
| OrcaSlicer | Direct Drive und Bowden getrennt | Temperatur 230→190 °C in 5-°C-Schritten; Max-Flow 5/20/0,5 mm³/s; PA DDE 0–0,1/0,002, Bowden 0–1,0/0,02; Retract DDE 0/2/0,1, Bowden 1/6/0,2; Input Shaping 15–110 Hz; VFA 40/200/10 mm/s |
| PrusaSlicer | Flow- und Temperaturturm im Assistenten | Flow 1–25 mm³/s in 15 Stufen; Temperatur 190–230 °C in 5 Stufen; weitere Tests nicht in allen Versionen eingebaut |
| Bambu Studio | Flow Dynamics und Flow Rate | PA-Pattern/PA-Line, Retraction, Max Flowrate, VFA; Input Shaping übernimmt der Drucker per Auto-Vibration |

Quellen (abgerufen am 14.11.2026):

- OrcaSlicer Wiki: <https://github.com/SoftFever/OrcaSlicer/wiki/Calibration>
- OrcaSlicer Kalibrierdialog: <https://github.com/SoftFever/OrcaSlicer/blob/main/src/slic3r/GUI/calib_dlg.cpp>
- Prusa Knowledge Base: <https://help.prusa3d.com/article/calibration>
- PrusaSlicer: <https://github.com/prusa3d/PrusaSlicer>
- Bambu Lab Wiki: <https://wiki.bambulab.com/en/software/bambu-studio/calibration>

## Bewährte externe Testmodelle

Die Links sind auch in der App unter „Bewährte Testmodelle“ zu finden. Lizenzen wurden an der Quelle geprüft; NC-Modelle sind als solche gekennzeichnet und nicht für kommerzielle Nutzung gedacht.

| Zweck | Modell | Lizenz |
| --- | --- | --- |
| Fluss | [Improved Flow Rate Calibration](https://www.printables.com/model/538734-improved-flow-rate-calibration) | CC0 |
| Temperatur | [Temperature Tower](https://www.printables.com/model/274675) | CC0 |
| Max. Volumenstrom | [Max Flow Test](https://www.printables.com/model/1870791) | CC BY-SA 4.0 |
| Pressure Advance | [PA Line Test](https://www.printables.com/model/1870778) | CC BY-SA 4.0 |
| Erste Schicht | [First Layer Test](https://www.printables.com/model/1871141) | CC BY-SA 4.0 |
| Retract | [Retraction Test](https://makerworld.com/en/models/177153) | Public Domain |
| Ringing / VFA | [Ringing Test](https://makerworld.com/en/models/450864) | CC BY-NC-SA 4.0 |

## Sicherheit

Die erzeugten G-Codes enthalten nur die Kalibrierbefehle, keine Heizprozedur und keinen Druckstart. Vor dem Senden prüfen: Material, Düse, Bett und Firmware-Unterstützung für `M900`/`M593`/`SET_PRESSURE_ADVANCE`/`SET_INPUT_SHAPER`.
