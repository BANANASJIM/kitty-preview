# Run as `kitty +launch`: prints the effective kitty colors and the cell size of the calling terminal.
import fcntl, json, os, struct, termios
from kitty.cli import create_default_opts


def cell_size():
    pid = os.getppid()
    while pid > 1:
        try:
            tty = os.readlink(f'/proc/{pid}/fd/0')
            if tty.startswith('/dev/pts/'):
                fd = os.open(tty, os.O_RDONLY | os.O_NOCTTY)
                rows, cols, width, height = struct.unpack('HHHH', fcntl.ioctl(fd, termios.TIOCGWINSZ, b'\0' * 8))
                os.close(fd)
                if width and height:
                    return [width / cols, height / rows]
        except OSError:
            pass
        with open(f'/proc/{pid}/stat') as f:
            pid = int(f.read().rsplit(')', 1)[1].split()[1])
    return None


opts = create_default_opts()
print(json.dumps({
    'bg': opts.background.as_sharp,
    'fg': opts.foreground.as_sharp,
    'accent': opts.color4.as_sharp,
    'cell': cell_size(),
}))
