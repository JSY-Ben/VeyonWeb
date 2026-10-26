<?php
declare(strict_types=1);
namespace Classroom;

final class ConfigWriter
{
    private static function exportable(mixed $value,int $depth=0): bool
    {
        if($depth>32)return false;
        if(is_array($value)){foreach($value as $item)if(!self::exportable($item,$depth+1))return false;return true;}
        return $value===null||is_scalar($value);
    }
    /** Change only top-level setting expressions in a normal PHP array config. */
    public static function update(string $source,array $raw,array $values): string
    {
        $tokens=token_get_all($source);$offsets=[];$offset=0;
        foreach($tokens as $token){$offsets[]=$offset;$offset+=strlen(is_array($token)?$token[1]:$token);}
        $ignored=static fn($token)=>is_array($token)&&in_array($token[0],[T_WHITESPACE,T_COMMENT,T_DOC_COMMENT],true);
        $brace=0;$root=null;
        for($i=0;$i<count($tokens);$i++){
            $token=$tokens[$i];
            if($token==='{')$brace++;if($token==='}')$brace--;
            if(is_array($token)&&$token[0]===T_RETURN&&$brace===0){
                $j=$i+1;while(isset($tokens[$j])&&$ignored($tokens[$j]))$j++;
                $arraySyntax=isset($tokens[$j])&&is_array($tokens[$j])&&$tokens[$j][0]===T_ARRAY;
                if($arraySyntax){$j++;while(isset($tokens[$j])&&$ignored($tokens[$j]))$j++;}
                if(isset($tokens[$j])&&($tokens[$j]==='['||($arraySyntax&&$tokens[$j]==='(')))$root=$j;
                break;
            }
        }
        // Computed configurations (e.g. JSON imports) become an explicit array,
        // preserving their evaluated values rather than adding an override layer.
        if($root===null){
            if(!self::exportable($raw))throw new ConfigWriteException('This computed configuration contains values that cannot be saved safely. Use a literal configuration array.');
            return "<?php\ndeclare(strict_types=1);\nreturn ".var_export(array_replace($raw,$values),true).";\n";
        }
        $depth=1;$start=$root+1;$segments=[];$close=null;
        for($i=$start;$i<count($tokens);$i++){
            $token=$tokens[$i];
            if(!is_array($token)&&in_array($token,['[','(','{'],true))$depth++;
            if(!is_array($token)&&in_array($token,[']',')','}'],true))$depth--;
            if($depth===0){$segments[]=[$start,$i-1];$close=$i;break;}
            if($depth===1&&$token===','){$segments[]=[$start,$i-1];$start=$i+1;}
        }
        if($close===null)throw new ConfigWriteException('Cannot identify the configuration array.');
        $changes=[];$found=[];
        foreach($segments as [$from,$to]){
            $parts=[];for($i=$from;$i<=$to;$i++)if(!$ignored($tokens[$i]))$parts[]=$i;
            if(count($parts)<3)continue;
            $key=$tokens[$parts[0]];$arrow=$tokens[$parts[1]];
            if(!is_array($key)||$key[0]!==T_CONSTANT_ENCAPSED_STRING||!is_array($arrow)||$arrow[0]!==T_DOUBLE_ARROW)continue;
            $name=substr($key[1],1,-1);if(!array_key_exists($name,$values))continue;
            $first=$parts[2];$last=$parts[count($parts)-1];$end=$offsets[$last]+strlen(is_array($tokens[$last])?$tokens[$last][1]:$tokens[$last]);
            $changes[]=[$offsets[$first],$end-$offsets[$first],var_export($values[$name],true)];$found[$name]=true;
        }
        $missing=array_diff_key($values,$found);
        if($missing){
            $last=$close-1;while($last>$root&&$ignored($tokens[$last]))$last--;
            $text=($last!==$root&&$tokens[$last]!==','?',':'')."\n";
            foreach($missing as $name=>$value)$text.='    '.var_export($name,true).' => '.var_export($value,true).",\n";
            $changes[]=[$offsets[$close],0,$text];
        }
        usort($changes,static fn($a,$b)=>$b[0]<=>$a[0]);
        foreach($changes as [$at,$length,$text])$source=substr_replace($source,$text,$at,$length);
        return $source;
    }
    public static function save(array $values): void
    {
        $path=realpath(Config::path());
        if($path===false||!is_file($path))throw new ConfigWriteException('Create config/local.php with setup before saving web settings.');
        $directory=dirname($path);
        if(!is_writable($directory))throw new ConfigWriteException('The web server needs write access to the configuration directory to save local.php. Run setup or adjust its group permissions.');
        $mask=umask(0007);$lock=@fopen($directory.'/.veyon-settings.lock','c');umask($mask);
        if(!$lock)throw new ConfigWriteException('Cannot create the configuration lock. Check configuration-directory permissions.');
        $temporary=null;
        try{
            if(!flock($lock,LOCK_EX))throw new ConfigWriteException('Cannot lock the configuration. Try again.');
            $source=@file_get_contents($path);
            if($source===false)throw new ConfigWriteException('Cannot read the configuration file.');
            if(function_exists('opcache_invalidate'))@opcache_invalidate($path,true);
            $raw=require $path;
            if(!is_array($raw))throw new ConfigWriteException('Configuration must return an array.');
            $output=self::update($source,$raw,$values);
            try{token_get_all($output,TOKEN_PARSE);}catch(\ParseError){throw new ConfigWriteException('Cannot safely update this configuration format.');}
            $temporary=@tempnam($directory,'.veyon-config-');
            if($temporary===false||dirname($temporary)!==$directory)throw new ConfigWriteException('Cannot create a temporary configuration file.');
            // Retain the PHP suffix rather than exposing config text as a
            // plain-text temporary file on hosts with a broad document root.
            $phpTemporary=$temporary.'.php';
            if(file_exists($phpTemporary)||!@rename($temporary,$phpTemporary))throw new ConfigWriteException('Cannot prepare the temporary configuration file.');
            $temporary=$phpTemporary;
            if(@file_put_contents($temporary,$output,LOCK_EX)!==strlen($output))throw new ConfigWriteException('Cannot write the configuration file.');
            $mode=((fileperms($path)&0660)|0600);
            if(!@chmod($temporary,$mode))throw new ConfigWriteException('Cannot secure the configuration file.');
            if(file_get_contents($path)!==$source)throw new ConfigWriteException('Configuration changed during the save. Reload settings and try again.');
            if(!@rename($temporary,$path))throw new ConfigWriteException('Cannot replace the configuration file. Check directory permissions.');
            $temporary=null;
            if(function_exists('opcache_invalidate'))@opcache_invalidate($path,true);
        }finally{if($temporary!==null&&is_file($temporary))unlink($temporary);flock($lock,LOCK_UN);fclose($lock);}
    }
}
