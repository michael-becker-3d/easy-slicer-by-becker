# Medien – Screenshots der Oberfläche

Aufnahmen aus der laufenden App mit dem Testmodell
`assets/shape-models/hyperion-skiff-x3.stl` (11.648 Dreiecke, 89 × 56 × 62 mm).
Dunkles Design, Fenster 1440 × 900 px. Die Bilder sind unbearbeitet und zeigen
die Oberfläche so, wie sie nach dem Start aussieht.

| Datei | Was zu sehen ist |
| ----- | ---------------- |
| `01-studio-klassisch.png` | Studio in der klassischen Ansicht: Werkstück-Panel mit Maßen, Volumen und Überhang links, Werkzeugleiste und 3D-Bett in der Mitte, Ergebnis und Vorschläge rechts. Modell geladen, noch nicht geslict. |
| `02-studio-werkstatt.png` | Werkstatt-Layout: Werkstück und 3D-Ansicht links, Einstellungen rechts (Filamentprofil, Qualitätsprofil, Suchfeld). Zeigt, dass Slicen und Einstellen in einem Fenster bleiben. |
| `03-textur-auf-modell.png` | 3D-Ansicht mit sichtbarer Oberflächenstruktur (Muster „Baumrinde“) auf Rumpf und Deck. Die Kachel misst 12 mm, also so viel wie später im G-code. |
| `04-gcode-ansicht.png` | Reiter G-Code: fremden G-Code einlesen, Analysieren/Vorschau/Konvertieren, links das leere Bett, rechts der Editor. |
| `05-kalibrieren.png` | Kalibrieren: Kreislauf aus Messen → Rechnen → ins Profil schreiben (Wandstärke, Fußbreite, Passungsspiel, PA) und der Block „Messwerte ins Filamentprofil“. |
| `06-multiprint.png` | Multiprint-Leerzustand: „Eine Datei – mehrere Platten – mehrere Drucker“ mit dem Knopf „3MF / STL öffnen“. |
| `07-drucker-ansicht.png` | Drucker-Ansicht: gespeicherte Drucker links, Druckstatus, Bettvermessung als 6 × 6-Raster, Z-Korrektur/Babystep rechts. |
| `08-detail-objektname.png` | Ausschnitt der 3D-Ansicht: Objekt mit Auswahlrahmen und vollständigem Namen. |

## Hinweise

- **Auflösung:** 1440 × 900 px, 8 Bit RGB, PNG ohne Bearbeitung. `03` und `08`
  sind Ausschnitte der 3D-Ansicht (688 × 521 bzw. 728 × 521 px).
- **Was die Bilder nicht zeigen:** „Kratzerfreie Oberfläche“ und „Web-Oberfläche“
  sind in der veröffentlichten Fassung abgeschaltet (`shared/release.ts`) und
  tauchen deshalb auf keinem Bild auf.
- **Keine echten Druckdaten:** Es wurde nichts gedruckt, nichts hochgeladen und
  keine Druckerkonfiguration verändert. Die gezeigten Werte sind Testdaten.
