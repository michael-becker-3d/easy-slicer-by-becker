$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'build\icon-png'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundedRectPath {
  param([System.Drawing.RectangleF]$Rect, [float]$Radius)
  $d = $Radius * 2.0
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($Rect.X, $Rect.Y, $d, $d, 180, 90)
  $path.AddArc($Rect.Right - $d, $Rect.Y, $d, $d, 270, 90)
  $path.AddArc($Rect.Right - $d, $Rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($Rect.X, $Rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-GradientBrush {
  param([System.Drawing.RectangleF]$Rect, [int]$Alpha)
  $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $Rect,
    [System.Drawing.Color]::FromArgb($Alpha, 94, 234, 212),
    [System.Drawing.Color]::FromArgb($Alpha, 251, 146, 60),
    45.0
  )
  $blend = [System.Drawing.Drawing2D.ColorBlend]::new()
  $blend.Colors = [System.Drawing.Color[]]@(
    [System.Drawing.Color]::FromArgb($Alpha, 94, 234, 212),
    [System.Drawing.Color]::FromArgb($Alpha, 251, 191, 36),
    [System.Drawing.Color]::FromArgb($Alpha, 251, 146, 60)
  )
  $blend.Positions = [float[]]@(0.0, 0.55, 1.0)
  $brush.InterpolationColors = $blend
  return $brush
}

function New-Point {
  param([float]$X, [float]$Y, [float]$Scale)
  return [System.Drawing.PointF]::new($X * $Scale, $Y * $Scale)
}

foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
  $scale = [float]($size / 40.0)
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $rect = [System.Drawing.RectangleF]::new(1.0 * $scale, 1.0 * $scale, 38.0 * $scale, 38.0 * $scale)
  $background = New-RoundedRectPath -Rect $rect -Radius (11.0 * $scale)
  $darkColor = [System.Drawing.ColorTranslator]::FromHtml('#0b1116')
  $darkBrush = [System.Drawing.SolidBrush]::new($darkColor)
  $graphics.FillPath($darkBrush, $background)

  $borderBrush = New-GradientBrush -Rect $rect -Alpha 255
  $borderPen = [System.Drawing.Pen]::new($borderBrush, [float](1.6 * $scale))
  $graphics.DrawPath($borderPen, $background)

  $lower = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $lower.AddPolygon([System.Drawing.PointF[]]@(
    (New-Point -X 10 -Y 24.6 -Scale $scale),
    (New-Point -X 20 -Y 19.2 -Scale $scale),
    (New-Point -X 30 -Y 24.6 -Scale $scale),
    (New-Point -X 20 -Y 30 -Scale $scale)
  ))
  $lowerBrush = New-GradientBrush -Rect $rect -Alpha 230
  $graphics.FillPath($lowerBrush, $lower)

  $chevron = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $chevron.AddLine((New-Point -X 10 -Y 18.6 -Scale $scale), (New-Point -X 20 -Y 13.2 -Scale $scale))
  $chevron.AddLine((New-Point -X 20 -Y 13.2 -Scale $scale), (New-Point -X 30 -Y 18.6 -Scale $scale))
  $chevronBrush = New-GradientBrush -Rect $rect -Alpha 191
  $chevronPen = [System.Drawing.Pen]::new($chevronBrush, [float](2.2 * $scale))
  $chevronPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $chevronPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $chevronPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawPath($chevronPen, $chevron)

  $top = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $top.AddLine((New-Point -X 14.5 -Y 10.5 -Scale $scale), (New-Point -X 25.5 -Y 10.5 -Scale $scale))
  $topBrush = New-GradientBrush -Rect $rect -Alpha 115
  $topPen = [System.Drawing.Pen]::new($topBrush, [float](1.8 * $scale))
  $topPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $topPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawPath($topPen, $top)

  $cut = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $cut.AddLine((New-Point -X 8 -Y 32 -Scale $scale), (New-Point -X 32 -Y 8 -Scale $scale))
  $cutDarkPen = [System.Drawing.Pen]::new($darkBrush, [float](3.2 * $scale))
  $cutDarkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $cutDarkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawPath($cutDarkPen, $cut)

  $cutBrush = New-GradientBrush -Rect $rect -Alpha 255
  $cutPen = [System.Drawing.Pen]::new($cutBrush, [float](1.1 * $scale))
  $cutPen.DashPattern = [float[]]@(2.5, 3.0)
  $cutPen.DashCap = [System.Drawing.Drawing2D.DashCap]::Round
  $cutPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $cutPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawPath($cutPen, $cut)

  $file = Join-Path $outDir ("icon-$size.png")
  $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "Icon: $file"

  $cutPen.Dispose()
  $cutBrush.Dispose()
  $cutDarkPen.Dispose()
  $topPen.Dispose()
  $topBrush.Dispose()
  $chevronPen.Dispose()
  $chevronBrush.Dispose()
  $lowerBrush.Dispose()
  $lower.Dispose()
  $borderPen.Dispose()
  $borderBrush.Dispose()
  $darkBrush.Dispose()
  $background.Dispose()
  $top.Dispose()
  $chevron.Dispose()
  $cut.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
