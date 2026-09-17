import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Collection, Draft, emptyCollection, initialAlignment, newDraft, normalizeSubject } from './src/model';
import { exportCollection, importCollection, loadCollection, saveDraft } from './src/storage';
import { Capture } from './src/Capture';
import { AlignmentStage } from './src/AlignmentStage';
import { Button, colors, Message } from './src/ui';
import { coverAlignment } from './src/cameraGeometry';

const steps = ['Artwork', 'Reference', 'Details'];
const titles = ['Start with the artwork.', 'Find the real-world view.', 'Give it a home.'];
const subtitles = ['Photograph a painting, sketch, or photograph you want to place in the world.',
  'Line up the artwork over your camera, then capture the scene in front of you.',
  'Choose a subject to keep different perspectives of the same place together.'];

export default function App() {
  return <SafeAreaProvider><Main /></SafeAreaProvider>;
}

function Main() {
  const [collection, setCollection] = useState<Collection>(emptyCollection);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [step, setStep] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const [transfer, setTransfer] = useState<'export' | 'import' | null>(null);
  const [alignmentReady, setAlignmentReady] = useState(false);
  const saveLock = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const blocked = busy || captureBusy;
  const { width } = useWindowDimensions();
  const mobile = Platform.OS !== 'web' || width < 768;
  const immersive = mobile && (step === 0 || step === 1);

  async function load() {
    setLoading(true); setError(''); setLoadFailed(false);
    try { setCollection(await loadCollection()); }
    catch { setError('Your local collection could not be opened. Retry before adding images.'); setLoadFailed(true); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [step]);
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === null) return false;
      if (!blocked) { if (step > 0) setStep(step - 1); else setDiscard(true); }
      return true;
    });
    return () => handler.remove();
  }, [step, blocked]);

  function start(subject = '') {
    setDraft(newDraft(subject)); setAlignmentReady(false); setStep(0); setError(''); setNotice('');
  }
  function update(patch: Partial<Draft>) { setDraft(previous => ({ ...previous, ...patch })); }
  async function save() {
    if (saveLock.current) return;
    saveLock.current = true; setBusy(true); setError('');
    try {
      const updated = await saveDraft(collection, draft);
      setCollection(updated); setStep(null); setDraft(newDraft()); setNotice('Perspective saved to your collection.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Your draft is still here; please try again.'); }
    finally { saveLock.current = false; setBusy(false); }
  }
  async function download() {
    setBusy(true); setTransfer('export'); setError(''); setNotice('');
    try { await exportCollection(collection); }
    catch (e) { setError(e instanceof Error ? e.message : 'Export failed. Please try again.'); }
    finally { setBusy(false); setTransfer(null); }
  }
  async function restore() {
    setBusy(true); setTransfer('import'); setError(''); setNotice('');
    try {
      const imported = await importCollection();
      if (imported) {
        setCollection(imported);
        setNotice(`Backup imported: ${imported.subjects.length} subjects and ${imported.entries.length} perspectives.`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed. Please check the backup and try again.'); }
    finally { setBusy(false); setTransfer(null); }
  }

  const captureView = (fullscreen: boolean) => <Capture key={step === 0 ? 'artwork' : 'reference'} fullscreen={fullscreen}
    photo={step === 0 ? draft.artwork : draft.reference} artwork={step === 1 ? draft.artwork : undefined}
    alignment={draft.alignment} onAlignment={alignment => update({ alignment })} onBusy={setCaptureBusy}
    onPhoto={photo => step === 0 ? (setAlignmentReady(false), update({ artwork: photo, alignment: { ...initialAlignment } })) : update({ reference: photo })}
    onBack={() => step === 1 ? setStep(0) : setDiscard(true)} onClose={() => setDiscard(true)}
    onContinue={() => {
      setError('');
      if (step === 0 && draft.artwork && !alignmentReady) {
        update({ alignment: coverAlignment(draft.artwork, 3 / 4) });
        setAlignmentReady(true);
      }
      setStep(step === 0 ? 1 : 2);
    }} />;
  return <SafeAreaView edges={immersive ? [] : ['top', 'bottom', 'left', 'right']} style={[styles.safe, immersive && { backgroundColor: '#101412' }]}>
    <StatusBar barStyle={immersive ? 'light-content' : 'dark-content'} />
    {immersive ? captureView(true) : <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <View style={styles.brandRow}>
          <View style={styles.logo}><Text style={styles.logoText}>◩</Text></View>
          <Text style={styles.brand}>parallax</Text><View style={{ flex: 1 }} />
          <View style={styles.localPill}><View style={styles.dot} /><Text style={styles.localText}>On this device</Text></View>
        </View>
        {loading ? <View style={styles.empty}><ActivityIndicator color={colors.ink} /><Text style={styles.body}>Opening your collection…</Text></View>
          : step === null ? <>
            <View style={styles.overviewHeading}><Text style={styles.eyebrow}>YOUR COLLECTION</Text><Text style={styles.title}>Places, through{ '\n' }different eyes.</Text>
              <Text style={styles.body}>A little art. A little reality. A new perspective.</Text></View>
            {!!error && <Message>{error}</Message>}
            {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
            {loadFailed ? <Button label="Retry opening collection" onPress={() => void load()} /> : <>
              <View style={styles.sectionRow}><View><Text style={styles.sectionTitle}>Subjects</Text><Text style={styles.small}>{collection.subjects.length} subjects · {collection.entries.length} perspectives</Text></View>
                <Button label="＋ Add image" onPress={() => start()} disabled={blocked} /></View>
              {collection.subjects.length === 0 ? <View style={styles.empty}>
                <View style={styles.emptyArt}><View style={styles.artBack} /><View style={styles.artFront}><Text style={styles.artSymbol}>↗</Text></View></View>
                <Text style={styles.emptyTitle}>Every place has a point of view.</Text><Text style={[styles.body, { textAlign: 'center', maxWidth: 290 }]}>Add an artwork and its real-world reference to start your first subject.</Text>
                <Button label="＋ Add your first image" onPress={() => start()} />
              </View> : <View style={styles.grid}>{collection.subjects.map(subject => {
                const entries = collection.entries.filter(entry => entry.subjectId === subject.id);
                return <View style={styles.card} key={subject.id}>
                  <Image source={{ uri: entries[0]?.artwork.uri }} accessibilityLabel={`First artwork for ${subject.name}`} style={styles.cover} resizeMode="cover" />
                  <View style={styles.cardContent}><Text style={styles.cardTitle}>{subject.name}</Text><Text style={styles.small}>{entries.length} {entries.length === 1 ? 'perspective' : 'perspectives'}</Text>
                    <Button label="＋ Add image here" secondary onPress={() => start(subject.name)} disabled={blocked} /></View>
                </View>;
              })}</View>}
              <View style={styles.exportCard}><View style={{ flex: 1, gap: 5 }}><Text style={styles.sectionTitle}>Keep your collection.</Text><Text style={styles.small}>Export or restore original photos, alignment, and notes in one ZIP.</Text></View>
                <View style={styles.transferActions}>
                  <Button label={transfer === 'import' ? 'Importing…' : '↑ Import data'} secondary onPress={() => collection.entries.length ? setConfirmImport(true) : void restore()} disabled={blocked} />
                  <Button label={transfer === 'export' ? 'Exporting…' : '↓ Export data'} secondary onPress={() => void download()} disabled={blocked || !collection.entries.length} />
                </View></View>
              <Text style={styles.footnote}>Stored locally. Importing a backup replaces the collection currently on this device.</Text>
            </>}
          </> : <>
            <View style={styles.flowNav}><Button label="← Back" secondary disabled={blocked} onPress={() => step > 0 ? setStep(step - 1) : setDiscard(true)} />
              <Text style={styles.small}>ADD A PERSPECTIVE</Text><Button label="Close" secondary disabled={blocked} onPress={() => setDiscard(true)} /></View>
            <View style={styles.steps}>{steps.map((label, index) => <View key={label} style={styles.stepItem}>
              <View style={[styles.stepLine, index <= step && { backgroundColor: colors.ink }]} /><Text style={[styles.stepLabel, index === step && { color: colors.ink, fontWeight: '700' }]}>{index + 1}. {label}</Text>
            </View>)}</View>
            <Text style={styles.flowTitle}>{titles[step]}</Text><Text style={styles.body}>{subtitles[step]}</Text>
            <View style={styles.flowBody}>
              {(step === 0 || step === 1) && captureView(false)}
              {step === 2 && <View style={{ gap: 20 }}>
                <View style={styles.preview}><AlignmentStage artwork={draft.artwork} reference={draft.reference} alignment={draft.alignment} onChange={() => {}} interactive={false} /></View>
                <View style={{ gap: 10 }}><Text style={styles.fieldLabel}>Subject <Text style={styles.small}>· required</Text></Text>
                  <TextInput accessibilityLabel="Subject" placeholder="e.g. The old bridge" placeholderTextColor={colors.muted} value={draft.subject} onChangeText={subject => update({ subject })} style={styles.input} maxLength={120} editable={!busy} />
                  {!!collection.subjects.length && <><Text style={styles.small}>Or choose an existing subject</Text><View style={styles.chips}>{collection.subjects.map(subject =>
                    <Pressable accessibilityRole="button" key={subject.id} disabled={busy} onPress={() => update({ subject: subject.name })} style={[styles.chip, normalizeSubject(draft.subject).toLowerCase() === subject.name.toLowerCase() && { backgroundColor: colors.accent }]}><Text style={{ color: colors.ink }}>{subject.name}</Text></Pressable>)}</View></>}
                </View>
                <View style={{ gap: 10 }}><Text style={styles.fieldLabel}>Description <Text style={styles.small}>· optional</Text></Text>
                  <TextInput accessibilityLabel="Description" placeholder="A detail, a memory, or a note for later…" placeholderTextColor={colors.muted} value={draft.description} onChangeText={description => update({ description })} style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]} multiline maxLength={4000} editable={!busy} /></View>
                <Text style={styles.small}>Both original photos, your alignment, and the date will be saved on this device.</Text>
              </View>}
              {!!error && <Message>{error}</Message>}
              {step === 2 && <View style={{ marginTop: 24 }}><Button label={busy ? 'Saving…' : 'Save perspective'} disabled={blocked || !normalizeSubject(draft.subject)} onPress={() => void save()} /></View>}
            </View>
          </>}
      </ScrollView>
    </KeyboardAvoidingView>}
    <Modal visible={discard} transparent animationType="fade" onRequestClose={() => setDiscard(false)}>
      <View style={styles.scrim}><View style={styles.dialog}><Text style={styles.sectionTitle}>Leave this perspective?</Text><Text style={styles.body}>Your unsaved photos and alignment will be discarded.</Text>
        <Button label="Keep editing" onPress={() => setDiscard(false)} /><Button label="Discard draft" secondary onPress={() => { setDiscard(false); setStep(null); setDraft(newDraft()); setError(''); }} /></View></View>
    </Modal>
    <Modal visible={confirmImport} transparent animationType="fade" onRequestClose={() => setConfirmImport(false)}>
      <View style={styles.scrim}><View style={styles.dialog}><Text style={styles.sectionTitle}>Replace this collection?</Text><Text style={styles.body}>Importing a backup replaces all subjects and perspectives currently stored on this device. Export first if you want to keep them.</Text>
        <Button label="Choose backup" onPress={() => { setConfirmImport(false); void restore(); }} /><Button label="Cancel" secondary onPress={() => setConfirmImport(false)} /></View></View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, page: { width: '100%', maxWidth: 960, alignSelf: 'center', padding: 24, paddingBottom: 48 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 36 }, logo: { backgroundColor: colors.ink, borderRadius: 10, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }, logoText: { color: colors.accent, fontSize: 25 },
  brand: { color: colors.ink, fontSize: 25, fontWeight: '600', letterSpacing: -1 }, localPill: { flexDirection: 'row', alignItems: 'center', gap: 6 }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#7B9261' }, localText: { color: colors.muted, fontSize: 11 },
  overviewHeading: { gap: 12, marginBottom: 32 }, eyebrow: { color: colors.muted, fontSize: 10, letterSpacing: 2, fontWeight: '700' }, title: { fontSize: 42, lineHeight: 46, letterSpacing: -1.8, color: colors.ink, fontWeight: '500' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 }, sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }, sectionTitle: { fontSize: 18, color: colors.ink, fontWeight: '600' }, small: { fontSize: 12, color: colors.muted, lineHeight: 19 },
  empty: { minHeight: 330, borderWidth: 1, borderStyle: 'dashed', borderColor: '#C9D0BE', borderRadius: 22, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 }, emptyTitle: { fontSize: 21, color: colors.ink, fontWeight: '500', textAlign: 'center' },
  emptyArt: { width: 100, height: 86, marginBottom: 8 }, artBack: { width: 65, height: 76, borderWidth: 1, borderColor: '#8B9E77', borderRadius: 9, position: 'absolute', left: 8, transform: [{ rotate: '-14deg' }], backgroundColor: '#E4EBD5' }, artFront: { width: 65, height: 76, borderRadius: 9, position: 'absolute', left: 30, top: 7, transform: [{ rotate: '10deg' }], backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' }, artSymbol: { color: colors.ink, fontSize: 38 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 }, card: { flexGrow: 1, flexBasis: 250, maxWidth: 440, backgroundColor: colors.white, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.line }, cover: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#E2E6D8' }, cardContent: { padding: 18, gap: 10 }, cardTitle: { fontSize: 21, fontWeight: '500', color: colors.ink },
  exportCard: { marginTop: 32, paddingTop: 24, borderTopWidth: 1, borderColor: colors.line, gap: 16, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }, transferActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, footnote: { marginTop: 18, fontSize: 11, lineHeight: 18, color: colors.muted }, notice: { padding: 14, backgroundColor: '#E3EECF', borderRadius: 12, marginBottom: 18, color: colors.ink },
  flowNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 24 }, steps: { flexDirection: 'row', gap: 8, marginBottom: 26 }, stepItem: { flex: 1, gap: 8 }, stepLine: { height: 3, backgroundColor: colors.line, borderRadius: 2 }, stepLabel: { color: colors.muted, fontSize: 11 }, flowTitle: { fontSize: 30, letterSpacing: -0.8, color: colors.ink, fontWeight: '500', marginBottom: 10 }, flowBody: { width: '100%', maxWidth: 500, alignSelf: 'center', marginTop: 24 },
  fieldLabel: { color: colors.ink, fontSize: 16, fontWeight: '600' }, input: { padding: 16, borderWidth: 1, borderColor: '#CBD3C4', backgroundColor: colors.white, borderRadius: 12, color: colors.ink, fontSize: 16 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#E8EBE1', borderRadius: 20 }, preview: { maxWidth: 230, width: '100%', alignSelf: 'center' },
  scrim: { flex: 1, backgroundColor: '#10261BCC', alignItems: 'center', justifyContent: 'center', padding: 24 }, dialog: { width: '100%', maxWidth: 380, padding: 24, borderRadius: 22, backgroundColor: colors.background, gap: 18 },
});
