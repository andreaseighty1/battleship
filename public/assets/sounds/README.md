Sound files expected by the frontend.

Music:
- `battleship_title.mp3` - title/home music loop. Optional for now.
- `battleship_battle.mp3` - battle music loop while a match is playing.

Effects:
- `fire_1.mp3`, `fire_2.mp3`, `fire_3.mp3` - cannon or torpedo launches. The frontend picks one randomly.
- `hit.mp3` - a normal hit.
- `miss.mp3` - a miss in the water.
- `hit.mp3` is also reused when a ship is sunk until a dedicated sink sound exists.
- `sonar.mp3` - sonar ping.
- `fire_1.mp3` and `fire_3.mp3` are reused for arcade barrage until a dedicated barrage sound exists.
- `winner_fanfare.mp3` - winner sting.
- `loser_fanfare.mp3` - loser sting.

UI sounds:
- Small click, select, rotate, place, ready, and error sounds are generated in code with Web Audio.
- No extra files are needed for the UI sounds.

Missing files are ignored silently, so these can be added one by one.
