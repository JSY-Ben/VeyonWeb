<?php
declare(strict_types=1);
namespace Classroom;

final class RfbFilter
{
    private string $buffer = '';
    public function __construct(private bool $viewOnly) {}
    public function push(string $data): string
    {
        $this->buffer .= $data;
        if (strlen($this->buffer) > 1048576) throw new \RuntimeException('Client message too large.');
        $output = '';
        while ($this->buffer !== '') {
            $b = $this->buffer; $size = strlen($b); $input = false;
            switch (ord($b[0])) {
                case 0: $length = 20; break;
                case 2: if ($size < 4) return $output; $length = 4 + unpack('n', substr($b,2,2))[1] * 4; break;
                case 3: $length = 10; break;
                case 4: $length = 8; $input = true; break;
                case 5: $length = 6; $input = true; break;
                case 6:
                    if ($size < 8) return $output;
                    $n = unpack('N', substr($b,4,4))[1]; if ($n > 0x7fffffff) $n = 0x100000000 - $n;
                    $length = 8 + $n; $input = true; break;
                case 41:
                    if ($size < 5) return $output;
                    $length = 5 + unpack('N', substr($b,1,4))[1];
                    if ($length > 1048576) throw new \RuntimeException('Client message too large.');
                    if ($size < $length) return $output;
                    // Allow only the read-only user query, never arbitrary feature commands.
                    if (substr($b,0,$length) !== Wire::feature('79a5e74d-50bd-4aab-8012-0e70dc08cc72')) throw new \RuntimeException('Unsupported Veyon feature request.');
                    break;
                case 150: $length = 10; break;
                case 248: if ($size < 9) return $output; $length = 9 + ord($b[8]); break;
                case 251: if ($size < 8) return $output; $length = 8 + ord($b[6]) * 16; $input = true; break;
                case 255:
                    if ($size < 2) return $output;
                    if (ord($b[1]) !== 0) throw new \RuntimeException('Unsupported QEMU input.');
                    $length = 12; $input = true; break;
                default: throw new \RuntimeException('Unsupported RFB client message.');
            }
            if ($length > 1048576) throw new \RuntimeException('Client message too large.');
            if ($size < $length) return $output;
            if (!$this->viewOnly || !$input) $output .= substr($b,0,$length);
            $this->buffer = substr($b,$length);
        }
        return $output;
    }
}
