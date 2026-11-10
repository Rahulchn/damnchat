/* Project illustrations only; legacy IDs preserve message/profile compatibility. */
globalThis.avatarCatalog = {
  choices: ["orbit", "bloom", "pixel", "comet", "sunny", "wave", "sage", "luna"],
  files: {
    orbit:"orbit.svg", bloom:"bloom.svg", pixel:"pixel.svg", comet:"comet.svg",
    sunny:"sunny.svg", wave:"wave.svg", sage:"sage.svg", luna:"luna.svg",
    gigachad:"orbit.svg", "jonah-hill":"bloom.svg", "roll-safe":"pixel.svg",
    patrick:"comet.svg", "handsome-squidward":"sunny.svg", "sad-frog":"wave.svg",
    facepalm:"sage.svg", doge:"luna.svg",
  },
  preferred(id) {
    return Object.hasOwn(this.files,id) ? this.files[id].slice(0,-4) : "orbit";
  },
};
