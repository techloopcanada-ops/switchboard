import React from 'react';
import { Text, View } from 'react-native';
import { C } from './theme';

/** Small markdown renderer for chat replies: fenced code, headings, lists, **bold** and `code`. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? <Text key={i} style={{ fontWeight: '800' }}>{part.slice(2, -2)}</Text>
        : part.startsWith('`') && part.endsWith('`') && part.length > 2
          ? <Text key={i} style={{ fontFamily: 'monospace', backgroundColor: C.line, color: C.mint }}>{part.slice(1, -1)}</Text>
          : <Text key={i}>{part}</Text>)}
    </>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/g);
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const newline = block.indexOf('\n');
          const code = (newline === -1 ? block : block.slice(newline + 1)).replace(/\n$/, '');
          return (
            <View key={index} style={{ backgroundColor: '#0A0E1C', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.line }}>
              <Text selectable style={{ color: C.text, fontFamily: 'monospace', fontSize: 13, lineHeight: 18 }}>{code}</Text>
            </View>
          );
        }
        return block.split('\n').map((line, i) => {
          if (!line.trim()) return <View key={`${index}-${i}`} style={{ height: 4 }} />;
          const heading = /^#{1,3}\s+(.*)$/.exec(line);
          if (heading) return <Text key={`${index}-${i}`} selectable style={{ color: C.text, fontSize: 17, fontWeight: '800', marginTop: 4 }}>{heading[1]}</Text>;
          const bullet = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
          return (
            <Text key={`${index}-${i}`} selectable style={{ color: C.text, fontSize: 16, lineHeight: 23, paddingLeft: bullet ? 8 : 0 }}>
              {bullet ? <Text style={{ color: C.accent }}>{/^\s*\d+\./.test(line) ? `${/(\d+)\./.exec(line)?.[1]}. ` : '• '}</Text> : null}
              <Inline text={bullet ? bullet[1] ?? '' : line} />
            </Text>
          );
        });
      })}
    </View>
  );
}
