/**
 * Kurztexte für die Info-Punkte an den Einstellungen: was ändert sich, wenn
 * der Wert steigt oder fällt. Schlüssel ist "Label" bzw. "Label|Einheit",
 * damit gleiche Beschriftungen mit anderer Einheit (z. B. "Düse" als
 * Temperatur und als Durchmesser) unterscheidbar bleiben.
 */
export const SETTING_INFO: Record<string, string> = {
  'Schichthöhe|mm':
    'Höhe einer Schicht. Kleiner (0,12 mm) = feinere Oberfläche, mehr Details, deutlich längere Druckzeit. Größer (0,28 mm) = schneller und stabiler, aber sichtbare Stufen. Faustregel: 25–75 % des Düsendurchmessers. Mit adaptiver Schichthöhe ist dieser Wert die Ausgangshöhe; die tatsächliche Höhe folgt dann der Moderneigung.',
  'Adaptive Schichthöhe':
    'Passt die Schichthöhe ab der zweiten Schicht an die Moderneigung an: flache und schräge Flächen bekommen feinere Schichten, steile Wände höhere. Das reduziert sichtbare Treppenstufen, ohne das ganze Teil mit der kleinsten Höhe zu drucken. Die erste Schicht bleibt bewusst unverändert.',
  'Min. Schichthöhe|mm':
    'Kleinste Schichthöhe, die die adaptive Planung auf flachen Flächen verwendet. Kleiner = feinere Oberseiten, aber mehr Schichten und längere Druckzeit. Der Wert muss unter der maximalen Schichthöhe liegen.',
  'Max. Schichthöhe|mm':
    'Größte Schichthöhe an senkrechten Wänden. Höher = schnellere Wände, aber die Stufenhöhe an flachen Flächen wird nicht schlechter, weil dort weiter verfeinert wird. Der Wert muss über der minimalen Schichthöhe liegen.',
  'Zielabweichung|mm':
    'Zulässige sichtbare Abweichung einer Treppenstufe. Kleiner (0,05–0,08 mm) ergibt glattere Schrägen und mehr Schichten; größer (0,12–0,20 mm) spart Zeit und ist bei dunklen oder strukturierten Oberflächen oft ausreichend.',
  'Gap-Fill':
    'Füllt Restflächen, die schmaler als eine normale Wand sind. Die Bahnbreite wird aus dem örtlichen Abstand berechnet, statt eine Lücke oder eine überbreite Wand zu erzeugen. Aus = schmale Bereiche bleiben leer.',
  'Min. Gap-Breite|mm':
    'Untere Grenze für die berechnete Lückenbreite. Kleinere Werte füllen feinste Spalten, können aber sehr dünne, schlecht haftende Bahnen erzeugen. Unter etwa 0,15 mm wird es mit einer 0,4-mm-Düse unzuverlässig.',
  'Max. Gap-Breite|mm':
    'Obere Grenze für die Lückenfüllung. Größere Werte schließen breitere Restflächen mit einer Bahn; zu groß gewählte Bahnen können über die eigentliche Lücke hinausragen und die Wand verdicken.',
  'Gap-Fluss|×':
    'Materialmenge der Lückenfüllung relativ zur berechneten Breite. 1,00 = passend. Etwas mehr (1,02–1,08) schließt raue Kanten; zu viel erzeugt Wülste, die die nächste Düsenbahn berühren.',
  'Height-Range-Modifier':
    'Ändert Einstellungen ab einer bestimmten Z-Höhe, z. B. langsamere erste Zentimeter, mehr Wände im Griffbereich oder weniger Füllung oben. Der Bereich gilt ab Schicht 2; der erste passende Bereich gewinnt, „Bis“ ist exklusiv. Linienbreite und Wandzahl wirken auch auf die Bahnplanung, nicht nur auf den Fluss.',
  'Erste Schicht|mm':
    'Dicke der ersten Schicht. Etwas dicker als die restlichen Schichten (meist 0,2–0,3 mm) gleicht unebenes Bett aus und verbessert die Haftung. Zu dick = schlechte Kanten, zu dünn = Ablösen.',
  'Linienbreite|mm':
    'Breite einer extrudierten Bahn. Etwas breiter als die Düse (z. B. 0,45 mm bei 0,4 mm Düse) schließt Lücken und hält stabil; schmaler erlaubt feinere Details, braucht aber mehr Bahnen und Zeit.',
  Wände:
    'Anzahl der Außenwände. Mehr Wände erhöhen die Festigkeit deutlich stärker als mehr Füllung, kosten aber Zeit. Drei Wände sind ein guter Kompromiss, fünf für stabile Funktionsteile.',
  Deckschichten:
    'Geschlossene Schichten oben. Mehr Deckschichten schließen die Oberfläche über der Füllung sauber; zu wenige zeigen „Pillowing“ (durchscheinende Füllung).',
  Bodenschichten:
    'Geschlossene Schichten unten. Mehr Bodenschichten bessern die Unterseite über Stützstrukturen und unebenen Betten; drei bis vier sind üblich.',
  'Dichte|%':
    'Anteil der Füllung im Inneren. 0 % = hohl, 15–20 % reicht für Deko, 40–60 % für mechanisch belastete Teile. Sehr hohe Werte kosten viel Zeit und Material.',
  'Füllung|%': 'Anteil der Füllung im Inneren. Mehr Füllung = schwerer und druckfester, aber langsamer.',
  Muster:
    'Form der Füllung. Grid ist stabil und schnell, Linien spart Material, Triangles verteilt Kräfte gleichmäßiger. Gyroid* ist eine weiche, allseitig belastbare Näherung (kein exaktes 3D-Gyroid), Waben bildet echte Sechseckzellen, Kreuz zwei diagonale Lagen. Cubic ist ein versetztes Würfelgitter, Octet kombiniert vier Richtungen (0/45/90/135°) für hohe allseitige Steifigkeit.',
  'Düse ⌀|mm':
    'Düsendurchmesser für die Berechnung von Linienbreite und Volumen. Muss zum eingebauten Düsenaufsatz passen — sonst stimmen Fluss und Wandstärke nicht.',
  'Filament ⌀|mm':
    'Durchmesser des Filaments (fast immer 1,75 mm). Der Slicer rechnet daraus das benötigte Fördervolumen; ein falscher Wert verändert Fluss und Maßhaltigkeit.',
  'Fluss|×':
    'Gesamtmultiplikator für extrudiertes Material. 1,00 = berechnet. Zu viel = Überextrusion (Rattern, Wülste), zu wenig = Lücken zwischen den Bahnen.',
  'Düse|°C':
    'Düsentemperatur während des Drucks. Höher = besseres Verbinden der Schichten, aber mehr Fäden und Verzug; zu niedrig = schlechte Haftung zwischen den Schichten.',
  'Düse erste Schicht|°C':
    'Düsentemperatur nur für die erste Schicht. Etwas heißer (z. B. +5 °C) verbessert die Haftung auf der Platte.',
  'Bett|°C':
    'Betttemperatur während des Drucks. Höher verbessert die Haftung, kann aber die Unterseite glänzend machen oder Warping bei großen Teilen fördern.',
  'Bett erste Schicht|°C': 'Betttemperatur nur für die erste Schicht — meist gleich oder etwas höher als danach.',
  Düsenmaterial:
    'Werkstoff der eingebauten Düse. Messing leitet Wärme am besten, wird aber von Kohlefaser und Glasfaser ausgeschliffen. Gehärteter Stahl oder Edelstahl halten abrasive Filamente aus. Bei „Unbekannt“ warnt der Slicer bei faserverstärkten Filamenten.',
  'Max. Volumenstrom|mm³/s':
    'Obergrenze, wie viel Material die Düse pro Sekunde schmelzen kann. Begrenzt automatisch die Geschwindigkeit: Linienbreite × Schichthöhe × Tempo darf diesen Wert nicht überschreiten.',
  'Innenwand|mm/s':
    'Tempo der inneren Wände. Schneller als die Außenwand, weil Unebenheiten dort nicht sichtbar sind — zu schnell verschlechtert aber die Verbindung zur Außenwand.',
  'Füllung|mm/s':
    'Tempo für die Füllung im Inneren. Hier sind hohe Werte üblich; der Volumenstrom begrenzt automatisch, wie schnell das Hotend schmelzen kann.',
  'Deckfläche|mm/s':
    'Tempo für Deckschichten und andere vollflächige Bereiche. Etwas langsamer als die Füllung ergibt glattere Oberflächen.',
  'Überhang|mm/s':
    'Tempo für Bereiche ohne Stütze unter der Schicht. Langsam drucken, damit die Kante nicht nach unten sackt.',
  'Stützen|mm/s': 'Tempo für Stützstrukturen. Sie werden meist schneller und mit weniger Qualitätsanspruch gedruckt.',
  'Füllwinkel|°':
    'Grundrichtung der Fülllinien. 45° verteilt Kräfte gleichmäßig und ist der übliche Standard; 0°/90° ist achsenparallel.',
  Beschleunigung:
    'Wie schnell der Drucker auf die eingestellte Geschwindigkeit kommt (M204). Höher = kürzere Druckzeit, aber mehr Vibrationen, ausgewaschene Ecken und lautere Bewegungen. Die Werksgrenze des Druckers wird nicht überschritten.',
  'Tempo|mm/s': 'Grundgeschwindigkeit für Innenwände, Füllung und Deckschichten. Schneller = kürzere Druckzeit, aber schwächere Verbindung und mehr Vibrationen.',
  'Druck|mm/s': 'Grundgeschwindigkeit für Innenwände, Füllung und Deckschichten. Schneller = kürzere Druckzeit, aber schwächere Verbindung und mehr Vibrationen.',
  'Außenwand|mm/s':
    'Geschwindigkeit der sichtbaren Außenhaut. Langsamer (etwa halbes Drucktempo) ergibt glattere Oberflächen und bessere Maßhaltigkeit.',
  'Reisen|mm/s':
    'Verfahrgeschwindigkeit ohne Material. Schneller verringert Fäden und Zeit, kann aber bei instabilen Aufbauten Teile umstoßen.',
  'Erste Schicht|mm/s':
    'Tempo der ersten Schicht. Langsam (15–25 mm/s) verbessert die Haftung; zu schnell reißt die Spur ab oder wird ungleichmäßig.',
  'Retract|mm':
    'Wie weit das Filament beim Reisen zurückgezogen wird. Mehr verhindert Fäden, kann aber die Düse kurz verstopfen oder Material abreißen; bei Direct-Drive meist 0,5–1 mm, bei Bowden 4–7 mm.',
  'Retract-Tempo|mm/s': 'Geschwindigkeit des Rückzugs. Schneller setzt den Faden sauberer ab, zu schnell kann das Filament durchrutschen.',
  'Retract ab Weg|mm': 'Ab welchem Fahrweg überhaupt zurückgezogen wird. Kleinere Werte = weniger Fäden, aber mehr Rückzüge und längere Druckzeit.',
  'Retract bei Schichtwechsel':
    'Zieht das Filament vor dem Höhenwechsel kurz zurück. Verhindert eine durchgehende Nahtwulst an der Schichtkante; kostet pro Schicht etwas Zeit.',
  'Lüfter aus – erste Schichten':
    'Anzahl Schichten ohne Bauteillüfter. Die erste Schicht braucht volle Betthaftung — Kühlung dort löst Ecken ab. Ab der eingestellten Schicht läuft der Lüfter mit der eingestellten Leistung.',
  'Mindestschichtzeit|s':
    'Ist eine Schicht schneller fertig als dieser Wert, wartet der Drucker die Restzeit ab. Nötig bei kleinen Teilen, damit die Schicht abkühlt und nicht zu einer klebrigen Säule wird.',
  Schrumpfkompensation:
    'Gleicht die Schrumpfung des Materials aus: Das Modell wird vor dem Slicen um den eingetragenen Prozentsatz größer gerechnet. PLA schrumpft wenig (0,2–0,5 %), ABS/ASA deutlich (0,6–1 %). X/Y wirkt auf Länge und Breite, Z auf die Höhe.',
  'X/Y|%':
    'Aufweitung in Länge und Breite. 0,4 % macht aus 100 mm rund 100,4 mm — nach dem Abkühlen liegt das Teil dann bei 100 mm.',
  'Z|%':
    'Aufweitung in der Höhe. Meist kleiner als X/Y, weil die Schichthaftung die Höhe zusätzlich staucht. 0 = keine Korrektur.',
  'Z-Hop|mm':
    'Anheben der Düse bei Verfahrwegen. Verhindert, dass die Düse über bereits gedruckte Flächen schleift und Teile abreißt; zu hoch = Fäden und längere Wege.',
  'Bauteilkühlung|%':
    'Leistung des Bauteillüfters. PLA braucht viel Kühlung, PETG etwa 50–60 %, ABS/ASA fast keine — zu viel Kühlung führt dort zu Rissen zwischen den Schichten.',
  'Rand|mm':
    'Abstand des adaptiven Messrasters zum Modell. Größer = mehr Rand, dafür robustere Messung; kleiner = genauere Werte direkt unter dem Druckteil.',
  Raster:
    'Anzahl der Messpunkte im adaptiven Raster. Mehr Punkte erfassen Unebenheiten genauer, dauern aber länger (Raster × Raster Punkte).',
  Naht:
    'Wo die Runde geschlossen wird, also die sichtbare Naht liegt: „Nächste“ nimmt die kürzeste Stelle, „Hinten“ legt sie nach hinten, „Bündig“ stapelt sie über die Schichten, „Zufall“ verteilt sie.',
  'Scarf-Naht':
    'Lässt Anfang und Ende einer geschlossenen Wand über eine kurze Strecke in Z und Fluss auslaufen, statt mit einer harten Kante aufeinanderzutreffen. Die Rampe beginnt auf der vorherigen Schicht und endet dort wieder; danach hebt der Slicer die Düse auf die volle Schichthöhe. Nur ab Schicht 2, nicht im Vasenmodus und nicht auf Saum oder Deckflächentextur.',
  'Scarf-Länge|mm':
    'Horizontale Strecke, über die die Scarf-Rampe an beiden Seiten der Naht läuft. Länger verteilt den Übergang weicher, kostet aber Zeit und kann bei kleinen Teilen die halbe Wand erfassen. 0 schaltet die Rampe ab; 10–20 mm sind ein guter Start.',
  'Scarf-Starthöhe|%':
    'Höhe am Rand der Rampe, als Anteil der Schichthöhe über der vorherigen Schicht. 0 beginnt direkt auf der vorherigen Schicht, 100 % würde die Rampe abschalten. 10–20 % geben einen schmalen, aber noch druckbaren Keil; zu klein kann unterextrudieren.',
  'Scarf-Schritte':
    'Mindestanzahl der Stützpunkte, über die die Rampe aufgeteilt wird. Mehr Schritte ergeben einen gleichmäßigeren Z- und Flussverlauf, verlängern aber den G-Code. Zehn Schritte reichen für die meisten Teile.',
  'Scarf-Fluss|×':
    'Zusätzlicher Flussfaktor im Scarf-Bereich. 1,0 ist der berechnete Fluss; der Slicer reduziert ihn ohnehin mit der wirksamen Schichthöhe. Werte unter 0,8 können die Naht dünn und unterextrudiert machen — nur bei sichtbarer Überextrusion senken.',
  'Scarf auch Innenwände':
    'Legt die Scarf-Rampe zusätzlich an Innenwände. Das kann innenliegende Nähte weicher machen, kostet aber Zeit und ist bei den meisten Teilen nicht nötig; die sichtbare Außenwand bleibt der Standard.',
  Glätten:
    'Ironing: Die Deckschicht wird nach dem Druck mit wenig Material noch einmal trocken überfahren. Ergibt glattere, geschlossene Oberflächen, kostet aber Zeit.',
  Haftung:
    'Randhilfe für die erste Schicht. Skirt spült die Düse frei, Brim vergrößert die Auflagefläche und hält schmale Teile fest.',
  'Sequenzieller Druck':
    'Druckt ein Objekt vollständig, bevor das nächste beginnt. Der Slicer sortiert niedrige Objekte zuerst und prüft den horizontalen Mindestabstand; so kann der Kopf später über bereits fertige Teile fahren. Die Kopfform und Portalhöhe kennt der Slicer nicht — vor dem Start am Drucker prüfen.',
  'Mindestabstand|mm':
    'Kleinster horizontaler Abstand zwischen zwei Objekt-Bounding-Boxen beim sequenziellen Druck. Größer = sicherer für Kopf und Portal, aber weniger Teile pro Bett. Saum und Brim werden als Rand mitgerechnet; Stützen können zusätzlich Platz brauchen.',
  'Arc-Fitting (G2/G3)':
    'Erkennt Folgen kurzer Geraden, die auf einem gemeinsamen Kreis liegen, und schreibt sie als G2/G3. Das verkürzt den G-Code auf runden Wänden und glättet die Fahrt. Nur geschlossene Konturen ohne Scarf-, Textur- und Vasen-Spirale; bei Zweifeln ausschalten.',
  'Kreisbögen als G2/G3':
    'Gibt geeignete geschlossene Konturen als echte Kreisbögen aus. Die Firmware muss G2/G3 unterstützen (Marlin mit ARC_SUPPORT, Klipper, RepRapFirmware und Repetier tun das). Bei einer Firmware ohne Bogenunterstützung bleibt die Funktion aus.',
  'Bogen-Toleranz|mm':
    'Größte radiale Abweichung, die ein ersetzter Punkt vom Kreis haben darf. Kleiner = genauer, aber mehr G1-Segmente; größer = kürzerer G-Code, kann enge Ecken stärker runden. 0,03–0,08 mm sind ein guter Start.',
  'Min. Segmente':
    'Mindestanzahl kurzer Geraden, die ein Bogen ersetzen muss. Höher = nur lange, klar gekrümmte Folgen werden Bögen; kleiner = auch kurze Rundungen. Unter 3 ist kein sinnvoller Bogen möglich.',
  Stützstruktur:
    'Stützen tragen Überhänge. „Normal“ zieht senkrechte Säulen unter den Überhang, „Baum“ weitet die Säule nach unten auf und spart Material. Aus = keine Stützen, Überhänge hängen dann durch.',
  'Überhangwinkel|°':
    'Ab welcher Neigung gestützt wird, gemessen zur Senkrechten. 50° stützt nur flache Überhänge, 30° auch steilere — mehr Stützen, sauberere Unterseiten.',
  'Stützdichte|%':
    'Dichte der Stützfüllung. 10–15 % tragen zuverlässig und lassen sich leicht abbrechen; höher nur bei schweren Überhängen.',
  'Z-Abstand|mm':
    'Luft zwischen Stützspitze und Bauteil. Zu klein = Stütze wächst an und lässt sich nicht lösen, zu groß = Überhang hängt durch. 0,15–0,25 mm sind üblich. Der Wert wird gegen die tatsächlichen Schichtoberkanten geprüft, damit er auch bei adaptiven Schichthöhen stimmt.',
  'XY-Abstand|mm':
    'Seitlicher Abstand der Stütze zur Wand. Verhindert, dass die Stütze an der Außenhaut klebt; 0,5–0,8 mm reichen meist. Der Abstand vergrößert den Stützfuß um die Wand; bei schmalen Überhängen bleibt trotzdem eine tragende Kontaktlinie erhalten.',
  Kontaktlagen:
    'Anzahl verdichteter Schichten direkt unter dem Bauteil. Mehr Kontaktlagen geben eine glattere Unterseite, kleben aber stärker. Die Lagen sitzen auf der tatsächlichen Stützspitze, auch bei gemischten Schichthöhen.',
  'Kontaktdichte|%':
    'Dichte der Kontaktfläche. Höher = glattere Unterseite über der Stütze, aber schwerer zu lösen. 70–90 % sind ein guter Kompromiss.',
  Stützmuster:
    'Form der Stützfüllung: Gitter ist stabil, Linien spart Material, Zickzack lässt sich am leichtesten abbrechen. Das gewählte Muster gilt für den Stützkörper; die Kontaktlagen haben ein eigenes Muster.',
  'Baumwinkel|°':
    'Wie stark sich eine Baumstütze nach unten aufweitet. Größer = breiterer Stand und mehr Material, kleiner = schlankere Säulen. Die Aufweitung folgt jeder tatsächlichen Schichthöhe; feine Lagen wachsen entsprechend weniger.',
  'Bett-Mesh':
    'Aus: keine Bettkorrektur im G-Code. „Im G-Code“: Das gemessene Mesh wird fest in die Z-Werte geschrieben — der Druck läuft danach auch von SD-Karte ohne Verbindung.',
  'Adaptiv vor dem Start':
    'Vor dem Druck wird nur der Bereich unter dem Modell neu vermessen und die Werte werden eingerechnet. Genauer als das ganze Bett, dauert aber etwas länger.',
  'Z-Offset nachführen':
    'Vergleicht den Z-Nullpunkt vor dem Druck mit einer gespeicherten Referenz und korrigiert die erste Schicht automatisch. Braucht eine Referenz aus dem Drucker-Tab.',
  Qualitätsprofil:
    'Voreinstellung für Schichthöhe, Wände, Decklagen, Füllung, Tempo und Beschleunigung. Die Werte werden auf die Grenzen des gewählten Druckers begrenzt; die Rücksetzknöpfe stellen genau diese Profilwerte wieder her.',
  'Pressure Advance':
    'Gleicht den Druckaufbau im Hotend aus: Klipper nennt es Pressure Advance (SET_PRESSURE_ADVANCE), Marlin Linear Advance (M900). Der Schalter ist unabhängig vom Druckerprofil — wirksam wird der Wert nur, wenn die Firmware die Funktion unterstützt. Typisch: 0,02–0,08 bei Direct Drive, höher bei Bowden.',
  'Classic Jerk':
    'Erlaubte Richtungsänderung pro Sekunde an Ecken. Höher = schnellere Ecken, aber mehr Rütteln und ausgewaschene Kanten; niedriger = ruhiger, langsamer. Marlin schreibt M205 X/Y/Z/E. Klipper kennt Classic Jerk nicht und nutzt den X-Wert als Square Corner Velocity.',
  'Jerk X|mm/s': 'Classic-Jerk-Grenze der X-Achse (M205 X). Typisch 8–15 mm/s bei Bettdruckern; zu hoch lässt Ecken nachschwingen.',
  'Jerk Y|mm/s': 'Classic-Jerk-Grenze der Y-Achse (M205 Y). Unabhängig von X einstellen, wenn der Drucker unterschiedlich steif ist.',
  'Jerk Z|mm/s': 'Classic-Jerk-Grenze der Z-Achse (M205 Z). Meist sehr klein (0,2–0,5 mm/s), damit Z-Sprünge keine Rattermarken erzeugen.',
  'Jerk E|mm/s': 'Classic-Jerk-Grenze des Extruders (M205 E). Höher = schnellere Retracts, zu hoch kann das Filament durchrutschen.',
  'Junction Deviation|':
    'Alternative zu Classic Jerk in Marlin: Je größer der Wert, desto schneller werden Ecken durchfahren; zu groß erzeugt Überschwingen. Typisch 0,01–0,05. Wird als M205 J geschrieben; Klipper nutzt stattdessen Square Corner Velocity.',
  'Square Corner Velocity|mm/s':
    'Klipper-Grenze für Ecken (SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY). Höher = schnellere Richtungswechsel, aber mehr Vibrationen. Bei Marlin ohne Wirkung; dort Classic Jerk oder Junction Deviation verwenden.',
  'Frequenz X|Hz':
    'Input-Shaper-Frequenz der X-Achse. Sie wird aus der Ringmessung bzw. SHAPER_CALIBRATE übernommen. Der Turm im Kalibrieren-Tab zeigt, welcher Bereich am ruhigsten druckt.',
  'Frequenz Y|Hz':
    'Input-Shaper-Frequenz der Y-Achse. X und Y können sich deutlich unterscheiden — deshalb getrennt eintragen.',
  Dämpfung:
    'Dämpfung des Input Shapers. 0,1 ist der übliche Standard; höhere Werte dämpfen stärker, können aber die Oberfläche weicher machen. Bei Marlin M593 D…, bei Klipper übernimmt die Firmware den Wert aus der Kalibrierung.',
  'Erste Schicht Linie|mm':
    'Linienbreite nur auf der ersten Schicht. Breiter (bis etwa 120 % der Düse) verbessert die Haftung und schließt Lücken; zu breit wird die Kante unsauber.',
  'Außenwand Linie|mm':
    'Eigene Linienbreite der sichtbaren Außenwand. Etwas breiter als die Düse schließt Lücken und macht die Oberfläche gleichmäßiger; zu breit verwischt Details.',
  'Innenwand Linie|mm':
    'Linienbreite der inneren Wände. Breitere Bahnen erhöhen die Wandstärke und sparen Zeit, dürfen aber nicht mit der Außenwand kollidieren.',
  'Deckfläche Linie|mm':
    'Linienbreite der Deckschichten. Breite Bahnen schließen die Oberfläche schneller; bei feinen Details schmaler bleiben.',
  'Hauptfluss (global)|×':
    'Gesamtmultiplikator für extrudiertes Material. 1,00 = berechnet. Zu viel = Überextrusion, zu wenig = Lücken. Gilt für alle Bahnen; die Oberflächen- und Brückenflüsse wirken zusätzlich darauf.',
  'Bodenflächenfluss|×':
    'Materialmenge der untersten Sichtfläche. Etwas mehr verbessert die Unterseite über Stützen oder rauem Bett; zu viel erzeugt einen breiten Fuß.',
  'Deckflächenfluss|×':
    'Materialmenge auf der obersten Sichtfläche relativ zum normalen Fluss. Etwas mehr (1,02–1,05) schließt Poren; zu viel erzeugt Wülste und glänzende Streifen.',
  'Brückenfluss|×':
    'Materialmenge auf der freien Brückenspanne. Die Engine erkennt nur zweiseitig gehaltene Flächen als Brücke, legt die Bahnen quer zur kürzesten Spanne und verlängert sie in die Auflager. Etwas mehr Material stabilisiert die erste Lage; zu viel lässt die Brücke durchhängen.',
  'Füllungsüberlappung|%':
    'Wie weit die Füllung in die Innenwand hineinreicht. Mehr Überlappung verbindet Füllung und Wand besser, zu viel drückt Material nach außen.',
  'Zusätzliche Wand alle 2 Schichten':
    'Setzt auf jeder zweiten Schicht eine zusätzliche Innenwand. Das verzahnt Füllung und Wände und erhöht die Festigkeit, ohne jede Schicht zu verlangsamen.',
  'Nahtlücke|mm':
    'Kurze Lücke am Ende der Außenwand, bevor die Naht geschlossen wird. Mehr Lücke verringert eine Wulst, kann aber eine sichtbare Kerbe hinterlassen.',
  'Naht wischen':
    'Fährt nach dem Ende der Außenwand ohne Material noch ein Stück weiter und streift die Düse ab. Weniger Fäden an der Naht, minimal mehr Zeit.',
  'Glätten aktiv':
    'Ironing: Die Deckschicht wird mit heißer Düse und wenig Material noch einmal überfahren. Glattere Oberfläche, aber deutlich mehr Zeit auf großen Flächen.',
  Glättbereich:
    'Nur oberste Schicht glättet ausschließlich die sichtbare Deckfläche. Alle Deckschichten glättet jede geschlossene Lage — langsamer, aber auch Zwischenflächen werden geschlossen.',
  'Glättwinkel|°':
    'Richtung der Glättungsbahnen. 0° läuft parallel zur X-Achse, 45° diagonal; der Winkel sollte sich vom Füllmuster unterscheiden, damit keine Rillen doppelt verlaufen.',
  'Glättfluss|%':
    'Materialmenge beim Glätten, in Prozent des normalen Flusses. 10–15 % schließen die Oberfläche, ohne Wülste zu erzeugen; zu wenig lässt Rillen stehen, zu viel trägt sichtbar Material auf.',
  'Glättlinien-Abstand|mm':
    'Abstand zwischen zwei benachbarten Glättlinien, Mitte zu Mitte. Kleiner (z. B. 0,10 mm) = dichtere, glattere Fläche, aber mehr Zeit; größer = schneller, aber mit sichtbaren Rillen. Der Wert ist nicht der Düsenabstand.',
  'Glätteinzug|mm':
    'Abstand der Glättbahnen zur Außenwand. 0,2–0,4 mm verhindern, dass die Düse Material über die Wandkante zieht; bei 0 wird bis an die Kante geglättet und dort kann ein Grat entstehen.',
  Glättmuster:
    'Linien glätten in einer Richtung und sind schnell. Gitternetz fährt eine zweite Richtung im 90°-Winkel darüber; dadurch wird die Fläche gleichmäßiger, der G-Code aber länger. Konzentrisch legt geschlossene Ringe von außen nach innen — auf runden und quadratischen Flächen am gleichmäßigsten, braucht aber mehr Leerwege.',
  'Brücke|mm/s':
    'Tempo für Brücken ohne Stützmaterial. Die Richtung wird automatisch quer zur kürzesten unterstützten Spanne gewählt; einseitige Überhänge zählen nicht als Brücke. Langsamer (20–35 mm/s) lässt den Faden sauber spannen; zu schnell reißt er oder hängt durch.',
  'Stütz-Interface|mm/s':
    'Tempo der verdichteten Kontaktfläche zwischen Stütze und Bauteil. Etwas langsamer ergibt eine glattere Unterseite.',
  'Grundaccel|mm/s²':
    'Beschleunigung für normale Bahnen. Höher verkürzt Wege, erhöht aber Vibrationen und Kantenauswaschung.',
  'Außenwand accel|mm/s²':
    'Beschleunigung der sichtbaren Außenwand. Niedriger hält die Oberfläche ruhig; höher spart Zeit an großen geraden Flächen.',
  'Innenwand accel|mm/s²': 'Beschleunigung der Innenwände. Meist nahe am Grundwert; zu hoch kann die Verbindung zur Außenwand schwächen.',
  'Füllung accel|mm/s²': 'Beschleunigung der Füllung. Hier sind höhere Werte üblich, weil die Oberfläche weniger sichtbar ist.',
  'Deckfläche accel|mm/s²': 'Beschleunigung der Deckschichten. Niedriger ergibt gleichmäßigere Oberflächen und weniger Ringing.',
  'Brücke accel|mm/s²': 'Beschleunigung auf Brücken und ihren Ankern. Zu hoch reißen die gespannten Fäden leichter ab.',
  'Stützen accel|mm/s²': 'Beschleunigung der Stützstruktur. Höhere Werte sind meist unkritisch, können aber dünne Säulen umstoßen.',
  'Stütz-Interface accel|mm/s²': 'Beschleunigung der Kontaktfläche. Niedriger hält die verdichtete Lage gleichmäßig und löst sich sauberer.',
  'Reisen accel|mm/s²': 'Beschleunigung auf Fahrten ohne Material. Höher verkürzt Wege, kann aber Bauteile durch Rütteln verschieben.',
  'Erste Schicht accel|mm/s²': 'Beschleunigung der ersten Schicht. Niedriger verbessert die Haftung, besonders bei großen Teilen und glatten Platten.',
  Kontaktmuster:
    'Muster der verdichteten Stütz-Kontaktlage. Linien lösen sich am leichtesten, Gitter gibt eine gleichmäßigere Unterseite, Zickzack ist ein Kompromiss. Bei schmalen Kontaktflächen ergänzt die Engine eine engere Querlinie quer zur längeren Achse, damit die Fläche nicht leer bleibt.',
  'Prime-Linie':
    'Zieht vor dem Druck eine kurze Linie am Rand, damit die Düse gleichmäßig gefüllt ist. Verhindert fehlende erste Bahnen, kostet wenig Material.',
  'Prime-Länge|mm': 'Länge der Reinigungslinie. Länger spült die Düse gründlicher frei und braucht mehr Platz am Plattenrand.',
  'Prime-Tempo|mm/s': 'Tempo der Prime-Linie. Langsam baut gleichmäßigen Druck auf; zu schnell kann das Material abbrechen.',
  'Adaptiv-Rand|mm':
    'Abstand des adaptiven Messrasters zum Modell. Mehr Rand misst großzügiger, kostet aber Zeit; zu wenig Rand erfasst die Bauteilkante nicht sicher.',
  'Adaptiv-Raster':
    'Anzahl der Messpunkte im Modellbereich. Mehr Punkte erfassen Unebenheiten genauer, verlängern aber die Messung (Raster × Raster).',
  'Shaper-Methode':
    'Klipper-Shaper-Typ für SET_INPUT_SHAPER. ZV ist kurz und breit, MZV der übliche Allrounder, EI und die 2/3-Hump-Varianten glätten stärker, brauchen aber mehr Beschleunigungsreserve. Automatisch lässt den in Klipper konfigurierten Typ unverändert.',
  'Durchgehende Innenbahnen':
    'Verbindet kurze Wege zwischen Innenwänden und Füllbahnen ohne Rückzug und ohne Z-Hop. Das spart Rückzüge, Z-Bewegungen und Zeit; Außenwände, Deckschichten und Stützen behalten ihren normalen Rückzug.',
  Vasenmodus:
    'Druckt nur eine einzige Außenwand ohne Füllung und ohne Deck-/Bodenschichten — ideal für Vasen und Zylinder. Beim Slicen werden Wandzahl, Füllungsdichte und Deckschichten automatisch überschrieben (1 Wand, 0 % Füllung, 0 Deckschichten, keine Stützen). Die Düse steigt spiralförmig über die Wand an — keine Naht, kein Anheben pro Schicht. Das Teil wird nur von der Wandstärke getragen und ist oben offen.',
  'Objekt-Slot':
    'Ordnet ein einzelnes Objekt einem Filament-Slot zu. Der Slicer druckt Objekte mit verschiedenen Slots nacheinander und setzt dazwischen einen Filamentwechsel; echtes Mehrfarben pro Schicht ist noch nicht enthalten.',
  'Schichthöhe erste Schicht|mm':
    'Dicke der ersten Schicht. Dicker als die übrigen Schichten (0,2–0,3 mm) gleicht Bett-Unebenheiten aus und verbessert die Haftung. Zu dick = unsaubere Kanten und Überextrusion, zu dünn = die Spur reißt oder löst sich.',
  'Linienbreite erste Schicht|mm':
    'Breite der Bahnen auf der ersten Schicht. Breiter (bis etwa 120 % des Düsendurchmessers) schließt Lücken zum Bett und hält besser; zu breit quillt Material an den Kanten heraus.',
  Kompensation:
    'Zieht die erste Schicht vor dem Druck horizontal ein, damit der typische Elefantenfuß am Bauteilfuß nicht breiter als die oberen Schichten wird. Die Außenmaße der übrigen Schichten bleiben unverändert.',
  'Einzug pro Seite|mm':
    'Versatz der Bahnmitte je Seite. Positiv zieht nach innen, negativ weitet nach außen. Als Startwert 0,10–0,20 mm verwenden und am gedruckten Würfel messen; zu große Werte verringern Wandüberlappung und Haftfläche.',
  Kompensationsbereich:
    '„Nur Außenwand“ zieht die äußere Kontur ein und lässt Bohrungen unverändert. „Gesamte erste Schicht“ verschiebt auch Bohrungsränder und ist für einen gleichmäßigen Fuß geeignet, wenn alle Maße der ersten Schicht korrigiert werden sollen.',
  'Linienbreite Außenwand|mm':
    'Breite der sichtbaren Außenwand. Etwas breiter als die Düse schließt Lücken zwischen den Wänden; schmaler erlaubt feinere Details, braucht aber mehr Bahnen. Wirkt direkt auf Maßhaltigkeit und Oberfläche.',
  'Linienbreite Innenwand|mm':
    'Breite der inneren Wände. Breitere Bahnen erhöhen die Wandstärke und sparen Zeit; sie dürfen aber nicht mit der Außenwand kollidieren, sonst entstehen Wülste nach außen.',
  'Linienbreite Deckfläche|mm':
    'Breite der Bahnen auf Deckschichten. Breite Bahnen schließen die Fläche schneller; bei feinen Details oder kleinen Flächen schmaler bleiben, sonst bleiben Lücken am Rand.',
  Position:
    'Wo die Runde der Außenwand geschlossen wird: „Nächste“ nimmt die kürzeste Stelle, „Hinten“ legt die Naht nach hinten, „Bündig“ stapelt sie über alle Schichten zu einer senkrechten Linie, „Zufall“ verteilt sie. Eine gestapelte Naht ist am wenigsten sichtbar, aber mechanisch die schwächste Stelle.',
  'Glätttempo|mm/s':
    'Tempo beim Glätten. 20–25 mm/s schließen die Fläche gleichmäßig; schneller spart Zeit, lässt aber Rillen stehen, weil die Düse nicht lange genug Material verteilt.',
  'Reihenfolge der Wände':
    '„Innen zuerst“ druckt die Außenwand zuletzt — bessere Maßhaltigkeit, weil die Außenwand an schon gestütztes Material anschließt. „Außen zuerst“ ergibt eine saubere Außenhaut auf Kosten der Genauigkeit und kann pro Schicht einen Rückzug sparen.',
  'Reihenfolge innerhalb der Schicht':
    'Ob erst alle Wände und dann die Füllung gedruckt werden oder umgekehrt. Wände zuerst ist der Standard: Die Füllung kann sich an die Wände anlehnen und es entstehen weniger Lücken an der Innenwand.',
  'Sortierung der Einzelbahnen':
    '„Erzeugt“ behält die geometrische Reihenfolge und ist am schnellsten zu berechnen. „Kürzeste“ sucht den nächstgelegenen Pfad und verkürzt Leerfahrten — bei vielen kleinen Objekten deutlich, bei einem einzelnen Körper kaum spürbar.',
  Füllmuster:
    'Form der Füllung. Grid ist schnell und stabil, Gyroid belastbar in alle Richtungen, Waben spart Material, Linien/Konzentrisch sind für flexible Teile geeignet. Das Muster beeinflusst Festigkeit und Druckzeit stärker als die Dichte.',
  'Grundtempo|mm/s':
    'Grundgeschwindigkeit für Innenwände, Füllung und Deckschichten, sofern dort kein eigener Wert steht. Höher = kürzere Druckzeit, aber schwächere Schichthaftung und mehr Vibrationen.',
  Umrundungsringe:
    'Anzahl der Runden um das Objekt (Skirt). Sie spülen die Düse vor dem Druck frei und zeigen, ob der Fluss stimmt. Mehr Ringe kosten wenig Material, brauchen aber Platz auf der Platte.',
  'Art der Umrandung':
    '„Nur Außen“ zieht die Runden um das gesamte Objekt, „Nur Innen“ nur innerhalb der Kontur (bei mehreren Objekten), „Außen + Innen“ beides. Bei einem einzelnen Teil ist „Nur Außen“ üblich.',
  'Min. Extrusionslänge|mm':
    'Unterschreitet die gesamte Umrandung diese Länge, wird sie weggelassen. Verhindert, dass bei kleinen Teilen eine unnötig kurze Runde gezogen wird; 0 = immer drucken.',
  'Abstand zum Bauteil|mm':
    'Abstand der Umrandung zum Objekt. Größer hält die Runde sauber vom Bauteil fern; zu klein kann sie am Teil ankleben und die Oberfläche verschlechtern.',
  'Startpunkt|°':
    'Winkel, an dem die Umrandung beginnt. Meist in eine freie Ecke gelegt, damit die Naht der Runde nicht neben dem Bauteil liegt.',
  'Druckgeschwindigkeit|mm/s':
    'Tempo der Umrandung. Langsam (20–30 mm/s) zeigt Flussfehler deutlich; schneller ist möglich, verdeckt aber genau die Unregelmäßigkeiten, die man damit prüfen will.',
  'Höhe|Schichten':
    'Über wie viele Schichten die Umrandung gedruckt wird. Eine Schicht reicht zum Freispülen; mehrere Schichten verbessern bei kühlem Bett die Haftung und den Windschutz.',
  'Luftzug-Schutz':
    'Zieht eine hohe Wand um das Bauteil, die Zugluft abhält. Nützlich bei ABS/ASA und großen Teilen, kostet aber viel Material und Zeit.',
  Randtyp:
    'Form der Randhilfe (Brim): „Nur Außen“ legt einen Saum um das Teil, „Nur Innen“ in Aussparungen, „Außen + Innen“ beides. Ein Saum vergrößert die Auflagefläche und hält schmale, hohe Teile fest.',
  'Randbreite|mm':
    'Breite des Saums. Mehr Breite hält stärker, lässt sich aber schwerer abnehmen und braucht Platz auf der Platte. Bei stabilen Teilen reicht oft 0.',
  'Lücke zum Objekt|mm':
    'Abstand zwischen Saum und Bauteil. Eine kleine Lücke (0–0,1 mm) verbindet beides gut und lässt sich trotzdem lösen; zu viel Lücke bringt keine Haftung mehr.',
  'Brim-Flussverhältnis|×':
    'Materialmenge im Saum relativ zum normalen Fluss. Etwas mehr (1,05–1,2) drückt den Saum satt aufs Bett; zu viel erzeugt Wülste, an denen die Düse hängen bleibt.',
  'Oberflächenstruktur':
    'Legt eine prozedurale Struktur auf die Wand — von klassischem Fuzzy Skin bis zu Stein, Holz und Rändel. „Nur Außenwand“ ist der übliche Einsatz; „Alle Wände“ betrifft auch innenliegende Konturen. Mit „Auch Deckflächen“ kommt dieselbe Struktur als erhöhtes Höhenfeld auf die sichtbare Oberseite.',
  'Auch Deckflächen':
    'Legt die Struktur auf die oberste sichtbare Schicht. Die normale Deckschicht bleibt als geschlossene Auflage darunter; der Aufbau erfolgt nur nach oben, mit Randabstand und sicherem Abstand zwischen den Düsenbahnen. Mehr Aufbau kostet Material und Zeit, verändert aber nicht die Wandauslenkung.',
  Deckflächenmuster:
    'Eigenes Muster für die sichtbare Deckfläche. „Glatt (kein Muster)“ lässt nur die Oberseite ohne erhöhte Texturbahnen und behält die Wandtextur bei — die sichere Wahl für flache Deckel und Funktionsflächen. „Wie Wandmuster“ übernimmt die Wandstruktur; eine eigene Auswahl erlaubt zum Beispiel eine glatte Steinwand mit Holzmaserung auf der Oberseite. Tiefe, Merkmalsgröße, Richtung und Punktabstand gelten weiterhin gemeinsam.',
  Oberflächenmuster:
    'Wählt die Oberflächenstruktur: Fuzzy / Rauschen, Stein / Fels, Mauerwerk / Steinplatten, Holzmaserung, Holzjahresringe, Baumrinde, Gehämmert, Rändel / Rauten, Wellen, Marmor / Schiefer, Beton / Sandstein, Leder, Korbgeflecht / Wabe oder Bruchstein. Die Struktur wird aus der Punktposition berechnet und ist bei gleichen Einstellungen reproduzierbar.',
  Texturzonen:
    'Begrenzt die Oberflächenstruktur auf Höhenbereiche in Millimetern. Ohne Eintrag bleibt die ganze Höhe texturiert. Mit Zonen gilt die erste passende Zone; außerhalb aller Zonen bleibt die Oberfläche glatt. Eine Zone kann ein eigenes Muster tragen. Nützlich für einen glatten Sockel, eine texturierte Griffzone und eine separate Deckfläche.',
  'Tiefe|mm':
    'Wie weit die Wand durch das Muster nach innen und außen ausgelenkt wird. Mehr = deutlich sichtbare Struktur, aber auch mehr Material, Zeit und eventuell schwierigeres Reinigen.',
  'Merkmalsgröße|mm':
    'Größe der Struktur: bei Holz die Maserungsbreite, bei Mauerwerk die Blockhöhe, bei Rändel den Rillenabstand. Kleiner = feiner, größer = grober.',
  'Richtung|°':
    'Dreht das Muster um die Z-Achse. Bei gerichteten Mustern (Holz, Rinde, Rändel, Mauerwerk, Korb, Marmor) lässt sich die Struktur damit an das Bauteil anpassen; 0° läuft entlang X, 90° entlang Y. Positionsbasierte Muster wie Fels, Beton, Leder und Gehämmert bleiben unverändert.',
  'Punktabstand|mm':
    'Abstand der Stützpunkte auf der Wand. Kleiner = feinere Struktur und genauere Kanten, aber mehr kurze Bewegungen; größer = schnellere, gröbere Oberfläche.',
  'Düsentemperatur|°C':
    'Temperatur der Düse beim Druck. Höher verbindet die Schichten besser, erzeugt aber mehr Fäden und Verzug; zu niedrig führt zu schlechter Schichthaftung und rauer Oberfläche.',
  'Düsentemperatur erste Schicht|°C':
    'Düsentemperatur nur für die erste Schicht. Etwas heißer (etwa +5 °C) verbessert die Haftung auf der Platte; danach wieder auf den normalen Wert.',
  'Betttemperatur|°C':
    'Temperatur des Druckbetts. Höher verbessert die Haftung, kann aber die Unterseite glänzend machen und bei großen Teilen Warping fördern.',
  'Betttemperatur erste Schicht|°C':
    'Betttemperatur nur für die erste Schicht. Meist gleich oder etwas höher als danach — das verbessert die Haftung, ohne das ganze Teil warm zu halten.',
  'Lüfter aus in den ersten Schichten':
    'Anzahl der Schichten ohne Bauteillüfter. Die erste Schicht braucht volle Betthaftung; Kühlung dort löst Ecken ab. Ab der eingestellten Schicht läuft der Lüfter mit der eingestellten Leistung.',
  'Rückzugslänge|mm':
    'Wie weit das Filament beim Reisen zurückgezogen wird. Bei Direct Drive reichen 0,5–1 mm, bei Bowden 4–7 mm. Zu viel kann die Düse verstopfen, zu wenig erzeugt Fäden.',
  'Rückzugsgeschwindigkeit|mm/s':
    'Tempo des Rückzugs. Schneller setzt den Faden sauberer ab; zu schnell rutscht das Filament am Förderrad durch oder reißt.',
  'Rückzug ab Wegstrecke|mm':
    'Ab welcher Fahrstrecke überhaupt zurückgezogen wird. Kleiner = weniger Fäden, aber mehr Rückzüge und längere Druckzeit; größer = mehr Fäden, dafür schneller.',
  'Rückzug bei Schichtwechsel':
    'Zieht vor dem Höhenwechsel zurück und verhindert eine durchgehende Wulst an der Schichtkante. Kostet pro Schicht etwas Zeit — bei 100 Schichten summiert sich das.',
  'Junction Deviation':
    'Marlin-Alternative zu Classic Jerk: Je größer der Wert, desto schneller werden Ecken durchfahren; zu groß erzeugt Überschwingen. Typisch 0,01–0,05. Wird als M205 J geschrieben — Klipper nutzt stattdessen Square Corner Velocity.',
  'Objektnamen im G-Code':
    'Schreibt den Objektnamen als Kommentar vor die Bahnen und setzt die Firmware-Marker (Klipper EXCLUDE_OBJECT_*, Marlin M486), mit denen sich einzelne Objekte später ausschließen lassen.',
  Bahnkommentare:
    'Schreibt vor jede Extrusionsart einen Kommentar (z. B. „;TYPE:Outer wall“). Hilft bei der Analyse im Editor und beim Nachvollziehen, welche Bahn was ist — macht die Datei aber größer.',
  'Rückzug in der Füllung verringern':
    'Lässt kurze Wege innerhalb der Füllung ohne Rückzug und ohne Z-Hop durchlaufen. Das spart viele Rückzüge und Zeit; Außenwände, Deckflächen und Stützen behalten ihren normalen Rückzug.',
  'Liniennummern hinzufügen':
    'Setzt N-Nummern vor die G-Code-Befehle — nur für alte Firmware oder Prüfwerkzeuge nötig. Moderne Firmware ignoriert sie, die Datei wird etwas größer.',
  'Objekte ausschließen':
    'Schreibt Firmware-Marker, mit denen sich einzelne Objekte am Drucker noch abwählen lassen (Klipper EXCLUDE_OBJECT_*, Marlin M486). Die eigentliche Auswahl bleibt weiterhin die Objektliste',
  Musteratlas:
    'Zeigt alle 14 Oberflächenmuster als echte, aus derselben Textur-Engine berechnete Swatches. Ein Klick übernimmt nur das Muster in die Wandtextur; Tiefe, Merkmalsgröße, Richtung und Punktabstand bleiben stehen. Ob mit Struktur geslict wird, entscheidet allein der Schalter „Oberflächenstruktur“ — ansehen lässt sich das Muster auch ohne ihn über „Muster in 3D ansehen“.',
  'Textur-Presets':
    'Kuratierte Looks aus Muster, Tiefe, Merkmalsgröße, Richtung und Punktabstand. Ein Preset setzt diese fünf Werte gemeinsam, schaltet aber nichts ein: Ob mit Struktur geslict wird, entscheidet allein der Schalter „Oberflächenstruktur“. Deckflächenmuster und Texturzonen bleiben unverändert.',
  Flächenzuweisung:
    'Legt das Oberflächenmuster nur auf ausgewählte Wandseiten: vorne (−Y), hinten (+Y), links (−X) und rechts (+X). Abgeschaltete Seiten bleiben glatt. Die Zuordnung folgt der Hauptrichtung der Wand; bei runden oder stark verwinkelten Teilen gilt die jeweils nächstliegende Seite. Die 3D-Ansicht zeigt das Muster vor dem Slicen, ohne das Mesh umzubauen.',
  'Input Shaper':
    'Kompensiert Ringing durch Achsenresonanz. Frequenzen aus der Kalibrierung eintragen; falsche Werte können die Oberfläche verschlechtern.',
}

export function settingInfo(label: string, unit?: string): string | undefined {
  return SETTING_INFO[`${label}|${unit ?? ''}`] ?? SETTING_INFO[label]
}
