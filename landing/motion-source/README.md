# Route loop (Blender)

`route.py` renders the loop behind the landing page's hero route: two resume pages glide through Find, Evidence, Resume and
Submit (pausing at each stop) with a light-spark trail and a soft glow that blooms at the stop they reach. It uses the page's
own path (`ROUTE_D` in `landing/pages.mjs`, a 440 x 440 space), so the render lines up with the SVG line drawn on top.

    blender -b -P landing/motion-source/route.py -- /tmp/route-frames
    ffmpeg -framerate 30 -i /tmp/route-frames/f_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 25 -preset slow -movflags +faststart -an landing/assets/route-loop.mp4
    ffmpeg -framerate 30 -i /tmp/route-frames/f_%04d.png -c:v libvpx-vp9 -pix_fmt yuv420p -crf 34 -b:v 0 -row-mt 1 -an landing/assets/route-loop.webm
    ffmpeg -i /tmp/route-frames/f_0066.png -q:v 4 landing/assets/route-loop.jpg

Rendered on pure black: the page blends the video with `mix-blend-mode: screen`, so black disappears into the page ground and
only the glow and the pages show. 5 s at 30 fps, seamless (the loop wraps with the same step size as any other frame).
Blender 5.2, EEVEE. If the stops or the path in `pages.mjs` move, change `STOPS`/the path in `route.py` to match.
