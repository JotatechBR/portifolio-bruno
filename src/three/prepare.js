// Ajustes aplicados ao monograma depois de carregado (site e estúdio).
export function prepareMonogram(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}
