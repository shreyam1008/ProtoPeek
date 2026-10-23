@0x8000000000000100;

interface Factory @0x8000000000000101 {
  create @0 [T] (value :T) -> (value :Assignable(T));
}
interface Assignable @0x8000000000000102 (T) {
  echo @0 (value :T) -> (value :T);
}
