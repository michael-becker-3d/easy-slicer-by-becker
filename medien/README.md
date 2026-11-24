# Medien – Rohbilder für Instagram, Beiträge und Werbung

Aufnahmen aus der laufenden App (Dev-Server, Vite) mit dem Testmodell
`assets/shape-models/hyperion-skiff-x3.stl` (11.648 Dreiecke, 89 × 56 × 62 mm).
Dunkles Design, Fenster 1440 × 900 px (Bild 08 ist ein Ausschnitt der 3D-Ansicht).
Alle Bilder sind unbearbeitet – Zuschnitt, Text und Rahmen kommen in der
Bildbearbeitung dazu.

| Datei | Was zu sehen ist | Wofür geeignet |
| ----- | ---------------- | -------------- |
| `01-studio-klassisch.png` | Studio in der klassischen Ansicht: Werkstück-Panel mit Maßen/Volumen/Überhang links, Werkzeugleiste und 3D-Bett in der Mitte, Ergebnis und Vorschläge rechts. Modell geladen, noch nicht geslict. | Titelbild, „so sieht es aus“-Beitrag, Karussell-Karte 1 |
| `02-studio-werkstatt.png` | Werkstatt-Layout: Werkstück und 3D-Ansicht links, Einstellungen rechts (Filamentprofil, Qualitätsprofil, Suchfeld). Zeigt, dass Slicen und Einstellen in einem Fenster bleiben. | Beitrag zum Werkstatt-Modus, Vergleich klassisch/Werkstatt |
| `03-textur-auf-modell.png` | 3D-Ansicht mit sichtbarer Oberflächenstruktur (Muster „Baumrinde“) auf Rumpf und Deck. Die Kachel misst 12 mm, also so viel wie später im G-code. | Textur-Beitrag, Detailausschnitt für Reels-Cover |
| `04-gcode-ansicht.png` | Reiter G-Code: fremden G-Code einlesen, Analysieren/Vorschau/Konvertieren, links das leere Bett, rechts der Editor. | Beitrag „fremden G-Code prüfen“, Zielgruppe Klipper/Marlin |
| `05-kalibrieren.png` | Kalibrieren: Kreislauf aus Messen → Rechnen → ins Profil schreiben (Wandstärke, Fußbreite, Passungsspiel, PA) und der Block „Messwerte ins Filamentprofil“. | Kalibrier-Beitrag, Serien-Karte, Vertrauen/Genauigkeit |
| `06-multiprint.png` | Multiprint-Leerzustand: „Eine Datei – mehrere Platten – mehrere Drucker“ mit Knopf „3MF / STL öffnen“. | Beitrag für Druckfarmen/mehrere Drucker |
| `07-drucker-ansicht.png` | Drucker-Ansicht: gespeicherte Drucker links, Druckstatus, Bettvermessung als 6 × 6-Raster, Z-Korrektur/Babystep rechts. | Beitrag „Drucker im Blick“, AD5X/Klipper-Zielgruppe |
| `08-detail-objektname.png` | Ausschnitt der 3D-Ansicht: Objekt mit Auswahlrahmen und vollständigem Namen. | Detail-/Makro-Karte, Hintergrund für Zitat oder Preis |

## Hinweise für die Nutzung

- **Format:** Instagram-Beiträge sind 4:5 (1080 × 1350). Aus den 1440 × 900-Bildern
  lässt sich das mittig beschneiden; die wichtigen Panels liegen in der Mitte,
  die Ränder sind unkritisch.
- **Text im Bild:** Die Aufnahmen enthalten keine Werbetexte. Überschrift oben,
  Ausschnitt darunter – die dunkle Fläche lässt weiße Schrift gut lesen.
- **Was die Bilder bewusst nicht zeigen:** „Kratzerfreie Oberfläche“ und
  „Web-Oberfläche“ sind in der veröffentlichten Fassung abgeschaltet
  (`shared/release.ts`) und tauchen deshalb auf keinem Bild auf.
- **Keine echten Druckdaten:** Es wurde nichts gedruckt, nichts hochgeladen und
  keine Druckerkonfiguration verändert. Die gezeigten Werte sind Testdaten.

## Weiterverarbeitung

Die fertigen Instagram-Karten (1080 × 1350, mit Text) liegen separat unter
`instagram/easy-slicer-instagram-1.png` bis `-10.png`. Dieser Ordner enthält nur
die Rohaufnahmen.
